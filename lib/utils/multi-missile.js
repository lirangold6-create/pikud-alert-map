const { haversineKm } = require('./geo');
const { getCityRegion } = require('./regions');

const ADJACENT_REGIONS = new Set([
  'JERUSALEM_SHOMRON|TEL_AVIV_CENTER', 'TEL_AVIV_CENTER|JERUSALEM_SHOMRON',
  'TEL_AVIV_CENTER|NORTH', 'NORTH|TEL_AVIV_CENTER'
]);

function centroidOf(coords) {
  if (coords.length === 0) return { lat: 0, lng: 0 };
  return {
    lat: coords.reduce((s, c) => s + c.lat, 0) / coords.length,
    lng: coords.reduce((s, c) => s + c.lng, 0) / coords.length
  };
}

function dominantRegion(arr) {
  const rc = {};
  arr.forEach(c => { rc[c.region] = (rc[c.region] || 0) + 1; });
  return Object.entries(rc).sort((a, b) => b[1] - a[1])[0][0];
}

function evaluateClustering(c1, c2, patternName) {
  if (c1.length === 0 || c2.length === 0) return null;
  if (c2.length > c1.length) { const tmp = c1; c1 = c2; c2 = tmp; }

  const center1 = centroidOf(c1);
  const center2 = centroidOf(c2);
  const sep = haversineKm(center1.lat, center1.lng, center2.lat, center2.lng);
  const bal = c2.length / c1.length;

  return {
    patternName,
    cluster1: { cities: c1.map(c => c.name), center: center1, size: c1.length, seedName: dominantRegion(c1) },
    cluster2: { cities: c2.map(c => c.name), center: center2, size: c2.length, seedName: dominantRegion(c2) },
    separation: sep, balance: bal,
    score: sep * Math.min(bal, 1) * Math.log2(c2.length + 1)
  };
}

// --- Temporal clustering ---

function detectTemporalClusters(redCities, nameToCity) {
  const times = redCities.map(c => new Date(c.time).getTime()).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < times.length; i++) {
    const gapMin = (times[i] - times[i - 1]) / 60000;
    if (gapMin > 4) gaps.push({ index: i, gapMinutes: gapMin });
  }
  if (gaps.length === 0) return null;

  const largestGap = gaps.sort((a, b) => b.gapMinutes - a.gapMinutes)[0];
  const wave1 = redCities.slice(0, largestGap.index);
  const wave2 = redCities.slice(largestGap.index);
  const smallerWave = Math.min(wave1.length, wave2.length);
  if (smallerWave < 10 || smallerWave / redCities.length < 0.05) return null;

  const resolve = wave => {
    const coords = wave.map(c => nameToCity[c.name]).filter(c => c && c.lat != null);
    return centroidOf(coords);
  };
  const c1 = resolve(wave1);
  const c2 = resolve(wave2);
  const geoSep = haversineKm(c1.lat, c1.lng, c2.lat, c2.lng);

  // Temporal waves from the same missile naturally spread geographically as
  // alerts fan out. Require strong geographic separation (60km+) to confirm
  // the time gap represents genuinely different attack targets.
  if (geoSep < 60) return null;

  return {
    detected: true,
    type: 'temporal',
    clusters: [
      { cities: wave1.map(c => c.name), size: wave1.length, seedName: 'WAVE_1', time: wave1[0].time, center: c1 },
      { cities: wave2.map(c => c.name), size: wave2.length, seedName: 'WAVE_2', time: wave2[0].time, center: c2 }
    ],
    separation: geoSep,
    balance: Math.min(wave1.length, wave2.length) / Math.max(wave1.length, wave2.length),
    gapMinutes: largestGap.gapMinutes
  };
}

// --- Geographic clustering ---

function detectGeographicClusters(cityNames, nameToCity) {
  const coords = cityNames.map(name => {
    const city = nameToCity[name];
    return city && city.lat != null
      ? { name, lat: city.lat, lng: city.lng, region: getCityRegion(name, nameToCity) }
      : null;
  }).filter(Boolean);

  if (coords.length < 20) return null;

  const regionCounts = {};
  coords.forEach(c => { regionCounts[c.region] = (regionCounts[c.region] || 0) + 1; });

  const has = (region, min) => (regionCounts[region] || 0) >= min;
  const hasCentral = (regionCounts['TEL_AVIV_CENTER'] || 0) + (regionCounts['JERUSALEM_SHOMRON'] || 0) >= 10;

  const candidates = [];
  const push = (result) => { if (result) candidates.push(result); };

  const splitByRegion = (primary, secondary, fallbackLatSplit) => {
    const c1 = [], c2 = [];
    coords.forEach(c => {
      if (primary(c)) c1.push(c);
      else if (secondary(c)) c2.push(c);
      else fallbackLatSplit(c, c1, c2);
    });
    return [c1, c2];
  };

  if (has('SOUTH', 5) && hasCentral) {
    const [c1, c2] = splitByRegion(
      c => c.region === 'TEL_AVIV_CENTER' || c.region === 'JERUSALEM_SHOMRON',
      c => c.region === 'SOUTH',
      (c, a, b) => c.lat < 31.7 ? b.push(c) : a.push(c)
    );
    push(evaluateClustering(c1, c2, 'Central_vs_South'));
  }

  if (has('NORTH', 10) && has('JERUSALEM_SHOMRON', 5)) {
    const [c1, c2] = splitByRegion(
      c => c.region === 'NORTH',
      c => c.region === 'JERUSALEM_SHOMRON',
      (c, a, b) => c.lat > 32.5 ? a.push(c) : b.push(c)
    );
    push(evaluateClustering(c1, c2, 'North_vs_Jerusalem'));
  }

  if (has('NORTH', 10) && has('SOUTH', 5)) {
    const [c1, c2] = splitByRegion(
      c => c.region === 'NORTH',
      c => c.region === 'SOUTH',
      (c, a, b) => c.lat > 32.2 ? a.push(c) : b.push(c)
    );
    push(evaluateClustering(c1, c2, 'North_vs_South'));
  }

  if (has('TEL_AVIV_CENTER', 5) && has('JERUSALEM_SHOMRON', 5)) {
    const [c1, c2] = splitByRegion(
      c => c.region === 'TEL_AVIV_CENTER',
      c => c.region === 'JERUSALEM_SHOMRON',
      (c, a, b) => c.lng < 34.95 ? a.push(c) : b.push(c)
    );
    push(evaluateClustering(c1, c2, 'Coast_vs_Inland'));
  }

  // K-means++ fallback
  {
    const sorted = [...coords].sort((a, b) => a.lat - b.lat);
    const n = Math.max(3, Math.floor(coords.length * 0.1));
    const nSeed = centroidOf(sorted.slice(-n));
    const sSeed = centroidOf(sorted.slice(0, n));
    const c1 = [], c2 = [];
    coords.forEach(c => {
      haversineKm(c.lat, c.lng, nSeed.lat, nSeed.lng) < haversineKm(c.lat, c.lng, sSeed.lat, sSeed.lng)
        ? c1.push(c) : c2.push(c);
    });
    push(evaluateClustering(c1, c2, 'KMeans_LatSplit'));
  }

  // Prefer cross-region candidates over same-region
  const crossRegion = candidates.filter(c => c.cluster1.seedName !== c.cluster2.seedName);
  const bestList = (crossRegion.length > 0 ? crossRegion : candidates).sort((a, b) => b.score - a.score);
  if (bestList.length === 0) return null;

  const best = bestList[0];
  const sameRegion = best.cluster1.seedName === best.cluster2.seedName;
  const pair = best.cluster1.seedName + '|' + best.cluster2.seedName;
  const isAdjacent = ADJACENT_REGIONS.has(pair);
  const threshold = 60;

  if (best.separation > threshold && best.cluster2.size >= 10 && best.balance >= 0.05) {
    return {
      detected: true,
      clusters: [best.cluster1, best.cluster2],
      separation: best.separation,
      balance: best.balance
    };
  }

  return null;
}

// --- Main entry point ---

function detectMultiMissile(redCities, nameToCity) {
  if (!redCities || redCities.length < 20) return null;

  const hasTimings = typeof redCities[0] === 'object' && redCities[0].time;

  if (hasTimings) {
    const temporal = detectTemporalClusters(redCities, nameToCity);
    if (temporal) return temporal;
  }

  const cityNames = hasTimings ? redCities.map(c => c.name) : redCities;
  return detectGeographicClusters(cityNames, nameToCity);
}

function getRelevantCenter(cityName, multiMissileInfo, nameToCity) {
  if (!multiMissileInfo || !multiMissileInfo.detected) return null;

  const city = nameToCity[cityName];
  if (!city || city.lat == null) return null;

  const distances = multiMissileInfo.clusters.map((cluster, idx) => ({
    idx,
    dist: haversineKm(city.lat, city.lng, cluster.center.lat, cluster.center.lng),
    center: cluster.center
  }));
  const nearest = distances.reduce((a, b) => a.dist < b.dist ? a : b);

  return {
    lat: nearest.center.lat,
    lng: nearest.center.lng,
    clusterIndex: nearest.idx,
    clusterSize: multiMissileInfo.clusters[nearest.idx].size
  };
}

module.exports = {
  detectMultiMissile,
  getRelevantCenter
};
