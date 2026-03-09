const fs = require('fs');
const path = require('path');
const axios = require(path.join(__dirname, 'pikud-haoref-api/node_modules/axios'));

const TZEVAADOM_URL = 'https://api.tzevaadom.co.il/alerts-history';
const OREF_HISTORY_URL = 'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json';
const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

const cities = JSON.parse(fs.readFileSync(path.join(__dirname, 'pikud-haoref-api/cities.json'), 'utf8'));
const nameToCity = {};
cities.forEach(c => { nameToCity[c.name] = c; });

const COLLECTED_FILE = path.join(__dirname, 'collected-alerts.json');

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function centroid(points) {
  if (points.length === 0) return null;
  const sum = points.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

function getCityCoords(name) {
  const c = nameToCity[name];
  return (c && c.lat && c.lng) ? { lat: c.lat, lng: c.lng } : null;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  console.log('Fetching data...\n');

  const [tzevaadomRes, orefRes] = await Promise.all([
    axios.get(TZEVAADOM_URL, { timeout: 10000 }).then(r => r.data),
    axios.get(OREF_HISTORY_URL, {
      headers: OREF_HEADERS, responseType: 'arraybuffer', timeout: 10000
    }).then(r => {
      const text = Buffer.from(r.data).toString('utf8').replace(/^\uFEFF/, '');
      return JSON.parse(text);
    }).catch(() => [])
  ]);

  // Load collected data
  let collectedAlerts = [];
  if (fs.existsSync(COLLECTED_FILE)) {
    try {
      collectedAlerts = Object.values(JSON.parse(fs.readFileSync(COLLECTED_FILE, 'utf8')));
    } catch {}
  }

  // Merge all oref data and deduplicate
  const orefSeen = new Set();
  const allOref = [];
  for (const a of [...orefRes, ...collectedAlerts]) {
    const key = `${a.alertDate}|${a.data}|${a.title}`;
    if (!orefSeen.has(key)) {
      orefSeen.add(key);
      allOref.push(a);
    }
  }

  // ── Group oref alerts into events by time (20-min gap) ──
  const orefParsed = allOref.map(a => ({
    city: a.data,
    title: a.title,
    time: new Date(a.alertDate.replace(' ', 'T'))
  })).sort((a, b) => a.time - b.time);

  const orefEvents = [];
  if (orefParsed.length > 0) {
    let curr = [orefParsed[0]];
    for (let i = 1; i < orefParsed.length; i++) {
      if (orefParsed[i].time - orefParsed[i - 1].time > 20 * 60000) {
        orefEvents.push(curr);
        curr = [];
      }
      curr.push(orefParsed[i]);
    }
    if (curr.length > 0) orefEvents.push(curr);
  }

  console.log(`  Tzevaadom events: ${tzevaadomRes.length}`);
  console.log(`  Oref alerts (unique): ${allOref.length}`);
  console.log(`  Oref event groups: ${orefEvents.length}`);

  // ── For each oref event, analyze orange→red conversion using GREEN as proxy for ORANGE ──
  // Green ("event ended") goes to the SAME cities that initially got orange.
  // So: "warned cities" = union(orange cities, green cities)
  // "actually dangerous" = red cities

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ORANGE → RED CONVERSION ANALYSIS`);
  console.log(`  (Using "event ended" as proxy for "was warned")`);
  console.log(`${'═'.repeat(70)}\n`);

  const globalData = [];

  for (let ei = 0; ei < orefEvents.length; ei++) {
    const event = orefEvents[ei];
    const eStart = event[0].time;
    const eEnd = event[event.length - 1].time;

    const cityAlerts = {};
    for (const a of event) {
      if (!cityAlerts[a.city]) cityAlerts[a.city] = new Set();
      cityAlerts[a.city].add(a.title);
    }

    const warnedCities = new Set(); // orange OR green = was in the warning zone
    const redCities = new Set();

    for (const [city, titles] of Object.entries(cityAlerts)) {
      const isWarned = [...titles].some(t => t.includes('בדקות הקרובות') || t.includes('האירוע הסתיים'));
      const isRed = [...titles].some(t => t.includes('ירי רקטות וטילים'));
      if (isWarned) warnedCities.add(city);
      if (isRed) redCities.add(city);
    }

    if (warnedCities.size === 0 && redCities.size === 0) continue;
    if (warnedCities.size < 5) continue; // skip tiny events

    const converted = [...warnedCities].filter(c => redCities.has(c));
    const warnedOnly = [...warnedCities].filter(c => !redCities.has(c));
    const convRate = warnedCities.size > 0 ? (converted.length / warnedCities.size * 100) : 0;

    // Red zone center
    const redCoords = [...redCities].map(getCityCoords).filter(Boolean);
    const redCenter = centroid(redCoords);

    console.log(`──────────────────────────────────────────────────────────────────────`);
    console.log(`  EVENT #${ei + 1} | ${eStart.toLocaleTimeString('he-IL')} → ${eEnd.toLocaleTimeString('he-IL')} (${((eEnd - eStart) / 60000).toFixed(0)} min)`);
    console.log(`──────────────────────────────────────────────────────────────────────`);
    console.log(`  Warned cities (orange zone): ${warnedCities.size}`);
    console.log(`  Red alert cities:            ${redCities.size}`);
    console.log(`  ────────────────────────────`);
    console.log(`  Warned → Got red:            ${converted.length} (${convRate.toFixed(1)}%)`);
    console.log(`  Warned → NO red (false scare): ${warnedOnly.length} (${(100 - convRate).toFixed(1)}%)`);

    if (!redCenter) { console.log(''); continue; }

    console.log(`  Red zone center:             ${redCenter.lat.toFixed(4)}°N, ${redCenter.lng.toFixed(4)}°E`);

    // Compute distance for every warned city
    const cityDist = [...warnedCities].map(c => {
      const coords = getCityCoords(c);
      if (!coords) return null;
      return {
        city: c,
        dist: haversineKm(coords.lat, coords.lng, redCenter.lat, redCenter.lng),
        gotRed: redCities.has(c)
      };
    }).filter(Boolean).sort((a, b) => a.dist - b.dist);

    // Distance bucket table
    const buckets = [
      { label: '0-5 km', min: 0, max: 5 },
      { label: '5-10 km', min: 5, max: 10 },
      { label: '10-15 km', min: 10, max: 15 },
      { label: '15-20 km', min: 15, max: 20 },
      { label: '20-30 km', min: 20, max: 30 },
      { label: '30-50 km', min: 30, max: 50 },
      { label: '50-80 km', min: 50, max: 80 },
      { label: '80+ km', min: 80, max: 9999 },
    ];

    console.log(`\n  Distance from red zone center → Chance of getting red alert:\n`);
    console.log(`  ${'Distance'.padEnd(12)} ${'Warned'.padStart(7)} ${'→Red'.padStart(6)} ${'Prob'.padStart(6)}  Visual`);
    console.log(`  ${'─'.repeat(60)}`);

    for (const b of buckets) {
      const inB = cityDist.filter(c => c.dist >= b.min && c.dist < b.max);
      if (inB.length === 0) continue;
      const gotRed = inB.filter(c => c.gotRed);
      const rate = (gotRed.length / inB.length * 100);
      const bar = '█'.repeat(Math.round(rate / 5)) + '░'.repeat(20 - Math.round(rate / 5));
      console.log(`  ${b.label.padEnd(12)} ${String(inB.length).padStart(7)} ${String(gotRed.length).padStart(6)} ${rate.toFixed(0).padStart(4)}%  ${bar}`);
    }

    // Threshold
    for (let i = 0; i < cityDist.length; i++) {
      const remaining = cityDist.slice(i);
      const rate = remaining.filter(c => c.gotRed).length / remaining.length;
      if (rate < 0.5) {
        console.log(`\n  ⚡ 50% threshold: ~${cityDist[i].dist.toFixed(0)} km from red center`);
        break;
      }
    }
    for (let i = 0; i < cityDist.length; i++) {
      const remaining = cityDist.slice(i);
      const rate = remaining.filter(c => c.gotRed).length / remaining.length;
      if (rate < 0.1) {
        console.log(`  ⚡ 10% threshold: ~${cityDist[i].dist.toFixed(0)} km — beyond this, almost never red`);
        break;
      }
    }

    // Max red distance
    const maxRedDist = Math.max(...cityDist.filter(c => c.gotRed).map(c => c.dist));
    const minNonRedDist = Math.min(...cityDist.filter(c => !c.gotRed).map(c => c.dist));
    console.log(`\n  Farthest city that got red:    ${maxRedDist.toFixed(1)} km`);
    console.log(`  Closest city that did NOT:     ${minNonRedDist.toFixed(1)} km`);

    // Stats
    const convDists = cityDist.filter(c => c.gotRed).map(c => c.dist);
    const noDists = cityDist.filter(c => !c.gotRed).map(c => c.dist);
    console.log(`\n  Distance summary:`);
    console.log(`    Got red:     avg ${(convDists.reduce((s, d) => s + d, 0) / convDists.length).toFixed(1)} km, median ${median(convDists).toFixed(1)} km`);
    console.log(`    No red:      avg ${(noDists.reduce((s, d) => s + d, 0) / noDists.length).toFixed(1)} km, median ${median(noDists).toFixed(1)} km`);

    // Sample false-scare cities
    const falseScareSample = cityDist.filter(c => !c.gotRed).slice(0, 10);
    console.log(`\n  Closest warned cities that DIDN'T get red:`);
    for (const c of falseScareSample) {
      console.log(`    ${c.city.padEnd(25)} ${c.dist.toFixed(1)} km from center`);
    }

    console.log('');

    // Collect for global
    for (const c of cityDist) {
      globalData.push({ ...c, eventIndex: ei });
    }
  }

  // ── Global Analysis ──
  if (globalData.length > 0) {
    console.log(`${'═'.repeat(70)}`);
    console.log(`  GLOBAL ANALYSIS: ALL EVENTS COMBINED`);
    console.log(`${'═'.repeat(70)}\n`);

    const total = globalData.length;
    const gotRed = globalData.filter(c => c.gotRed).length;
    console.log(`  Total warned city-alerts:      ${total}`);
    console.log(`  Got red (actual danger):       ${gotRed} (${(gotRed / total * 100).toFixed(1)}%)`);
    console.log(`  False scare (no red):          ${total - gotRed} (${((total - gotRed) / total * 100).toFixed(1)}%)`);

    const buckets = [
      { label: '0-5 km', min: 0, max: 5 },
      { label: '5-10 km', min: 5, max: 10 },
      { label: '10-15 km', min: 10, max: 15 },
      { label: '15-20 km', min: 15, max: 20 },
      { label: '20-30 km', min: 20, max: 30 },
      { label: '30-40 km', min: 30, max: 40 },
      { label: '40-60 km', min: 40, max: 60 },
      { label: '60-80 km', min: 60, max: 80 },
      { label: '80-100 km', min: 80, max: 100 },
      { label: '100+ km', min: 100, max: 9999 },
    ];

    console.log(`\n  GLOBAL: Distance → Probability of needing shelter\n`);
    console.log(`  ${'Distance'.padEnd(12)} ${'Warned'.padStart(7)} ${'→Red'.padStart(6)} ${'Prob'.padStart(6)}  ${'Visual'.padEnd(22)} Meaning`);
    console.log(`  ${'─'.repeat(78)}`);

    for (const b of buckets) {
      const inB = globalData.filter(c => c.dist >= b.min && c.dist < b.max);
      if (inB.length === 0) continue;
      const gotRedB = inB.filter(c => c.gotRed);
      const rate = (gotRedB.length / inB.length * 100);
      const bar = '█'.repeat(Math.round(rate / 5)) + '░'.repeat(20 - Math.round(rate / 5));
      let meaning = '';
      if (rate >= 90) meaning = 'SHELTER NOW';
      else if (rate >= 70) meaning = 'Very likely danger';
      else if (rate >= 50) meaning = 'Likely shelter';
      else if (rate >= 30) meaning = 'Possible, stay alert';
      else if (rate >= 10) meaning = 'Unlikely but possible';
      else meaning = 'Almost certainly false';
      console.log(`  ${b.label.padEnd(12)} ${String(inB.length).padStart(7)} ${String(gotRedB.length).padStart(6)} ${rate.toFixed(0).padStart(4)}%  ${bar}  ${meaning}`);
    }

    // Repeated false-alarm analysis
    console.log(`\n  ─── TOP FALSE-SCARE CITIES ───`);
    console.log(`  (Repeatedly warned but rarely get red)\n`);

    const cityStats = {};
    for (const c of globalData) {
      if (!cityStats[c.city]) cityStats[c.city] = { warned: 0, gotRed: 0, dist: c.dist };
      cityStats[c.city].warned++;
      if (c.gotRed) cityStats[c.city].gotRed++;
    }

    const topFalse = Object.entries(cityStats)
      .filter(([, s]) => s.warned > 0 && s.gotRed === 0)
      .sort((a, b) => a[1].dist - b[1].dist)
      .slice(0, 20);

    console.log(`  ${'City'.padEnd(28)} ${'Warned'.padStart(7)} ${'Red'.padStart(5)} ${'Dist'.padStart(7)}  Status`);
    console.log(`  ${'─'.repeat(60)}`);
    for (const [city, s] of topFalse) {
      console.log(`  ${city.padEnd(28)} ${String(s.warned).padStart(7)} ${String(s.gotRed).padStart(5)} ${s.dist.toFixed(1).padStart(6)}km  Always false scare`);
    }
  }

  // ── Tzevaadom patterns ──
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ATTACK PATTERN ANALYSIS (tzevaadom, 2 days)`);
  console.log(`${'═'.repeat(70)}\n`);

  const attackClusters = { north: 0, center: 0, south: 0 };
  const attackSizes = { small: 0, medium: 0, large: 0 };

  for (const event of tzevaadomRes) {
    const redCities = new Set();
    for (const sub of event.alerts.filter(a => !a.isDrill)) {
      for (const city of sub.cities) redCities.add(city);
    }
    if (redCities.size === 0) continue;

    const coords = [...redCities].map(getCityCoords).filter(Boolean);
    const center = centroid(coords);
    if (!center) continue;

    if (center.lat > 33) attackClusters.north++;
    else if (center.lat > 31.5) attackClusters.center++;
    else attackClusters.south++;

    if (redCities.size <= 10) attackSizes.small++;
    else if (redCities.size <= 100) attackSizes.medium++;
    else attackSizes.large++;
  }

  console.log(`  Attack direction (by red zone center latitude):`);
  console.log(`    North (>33°N, Lebanon border):   ${attackClusters.north} events`);
  console.log(`    Center (31.5-33°N):              ${attackClusters.center} events`);
  console.log(`    South (<31.5°N, Gaza):           ${attackClusters.south} events`);

  console.log(`\n  Attack size distribution:`);
  console.log(`    Small (≤10 cities):   ${attackSizes.small} events — targeted/interception`);
  console.log(`    Medium (11-100):      ${attackSizes.medium} events — regional barrage`);
  console.log(`    Large (100+):         ${attackSizes.large} events — massive barrage`);

  console.log(`\n  KEY INSIGHT:`);
  console.log(`  The orange "בדקות הקרובות" alert covers a MUCH wider area than the`);
  console.log(`  actual red zone. If you are far from the red zone center, the chance`);
  console.log(`  of actually needing shelter is low. The orange alert is a precaution`);
  console.log(`  for the wider region, but the rockets typically land in a smaller area.`);

  console.log(`\n${'═'.repeat(70)}\n`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
