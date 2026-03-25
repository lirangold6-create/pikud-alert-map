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

const REGION_NAMES_HE = {
  JERUSALEM_SHOMRON: 'ירושלים והשומרון',
  TEL_AVIV_CENTER: 'תל אביב והמרכז',
  NORTH: 'הצפון',
  SOUTH: 'הדרום',
  OTHER: 'אזור נוסף'
};

function dominantRegionKey(arr) {
  const rc = {};
  arr.forEach(c => { rc[c.region] = (rc[c.region] || 0) + 1; });
  return Object.entries(rc).sort((a, b) => b[1] - a[1])[0][0];
}

// Pairwise separation stats for N clusters
function pairwiseSeparation(centers) {
  let min = Infinity, total = 0, count = 0;
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const d = haversineKm(centers[i].lat, centers[i].lng, centers[j].lat, centers[j].lng);
      if (d < min) min = d;
      total += d;
      count++;
    }
  }
  return { min, avg: count > 0 ? total / count : 0 };
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
    clusterCount: 2,
    cluster1: { cities: c1.map(c => c.name), center: center1, size: c1.length, regionKey: dominantRegionKey(c1), seedName: REGION_NAMES_HE[dominantRegionKey(c1)] || dominantRegionKey(c1) },
    cluster2: { cities: c2.map(c => c.name), center: center2, size: c2.length, regionKey: dominantRegionKey(c2), seedName: REGION_NAMES_HE[dominantRegionKey(c2)] || dominantRegionKey(c2) },
    separation: sep, balance: bal,
    score: sep * Math.min(bal, 1) * Math.log2(c2.length + 1)
  };
}

function evaluateNWayClustering(groups, patternName) {
  if (groups.length < 3 || groups.some(g => g.length === 0)) return null;

  groups.sort((a, b) => b.length - a.length);

  const centers = groups.map(g => centroidOf(g));
  const { min: minSep, avg: avgSep } = pairwiseSeparation(centers);
  const smallest = groups[groups.length - 1].length;
  const largest = groups[0].length;
  const bal = smallest / largest;

  return {
    patternName,
    clusterCount: groups.length,
    groups,
    centers,
    avgSeparation: avgSep,
    minSeparation: minSep,
    balance: bal,
    score: avgSep * Math.min(bal, 1) * Math.log2(smallest + 1) * (groups.length / 2)
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

  const sortedGaps = [...gaps].sort((a, b) => b.gapMinutes - a.gapMinutes);

  // --- Try 3-way temporal split (top 2 gaps) ---
  if (sortedGaps.length >= 2 && sortedGaps[1].gapMinutes > 4) {
    const splitIndices = [sortedGaps[0].index, sortedGaps[1].index].sort((a, b) => a - b);
    const wave1 = redCities.slice(0, splitIndices[0]);
    const wave2 = redCities.slice(splitIndices[0], splitIndices[1]);
    const wave3 = redCities.slice(splitIndices[1]);

    const smallest = Math.min(wave1.length, wave2.length, wave3.length);
    if (smallest >= 5 && smallest / redCities.length >= 0.03) {
      const resolve = wave => {
        const coords = wave.map(c => nameToCity[c.name]).filter(c => c && c.lat != null);
        return centroidOf(coords);
      };
      const c1 = resolve(wave1), c2 = resolve(wave2), c3 = resolve(wave3);
      const { min: minSep } = pairwiseSeparation([c1, c2, c3]);

      if (minSep >= 40) {
        return {
          detected: true,
          type: 'temporal',
          clusters: [
            { cities: wave1.map(c => c.name), size: wave1.length, seedName: 'גל 1', time: wave1[0].time, center: c1 },
            { cities: wave2.map(c => c.name), size: wave2.length, seedName: 'גל 2', time: wave2[0].time, center: c2 },
            { cities: wave3.map(c => c.name), size: wave3.length, seedName: 'גל 3', time: wave3[0].time, center: c3 }
          ],
          separation: Math.round(pairwiseSeparation([c1, c2, c3]).avg),
          balance: Math.min(wave1.length, wave2.length, wave3.length) / Math.max(wave1.length, wave2.length, wave3.length),
          gapMinutes: [sortedGaps[0].gapMinutes, sortedGaps[1].gapMinutes]
        };
      }
    }
  }

  // --- Fall back to 2-way temporal split ---
  const largestGap = sortedGaps[0];
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

  if (geoSep < 60) return null;

  return {
    detected: true,
    type: 'temporal',
    clusters: [
      { cities: wave1.map(c => c.name), size: wave1.length, seedName: 'גל 1', time: wave1[0].time, center: c1 },
      { cities: wave2.map(c => c.name), size: wave2.length, seedName: 'גל 2', time: wave2[0].time, center: c2 }
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

  const candidates2 = [];
  const candidates3 = [];
  const push2 = (result) => { if (result) candidates2.push(result); };
  const push3 = (result) => { if (result) candidates3.push(result); };

  const splitByRegion = (primary, secondary, fallbackLatSplit) => {
    const c1 = [], c2 = [];
    coords.forEach(c => {
      if (primary(c)) c1.push(c);
      else if (secondary(c)) c2.push(c);
      else fallbackLatSplit(c, c1, c2);
    });
    return [c1, c2];
  };

  // ═══ 2-WAY CANDIDATES ═══

  if (has('SOUTH', 5) && hasCentral) {
    const [c1, c2] = splitByRegion(
      c => c.region === 'TEL_AVIV_CENTER' || c.region === 'JERUSALEM_SHOMRON',
      c => c.region === 'SOUTH',
      (c, a, b) => c.lat < 31.7 ? b.push(c) : a.push(c)
    );
    push2(evaluateClustering(c1, c2, 'Central_vs_South'));
  }

  if (has('NORTH', 10) && has('JERUSALEM_SHOMRON', 5)) {
    const [c1, c2] = splitByRegion(
      c => c.region === 'NORTH',
      c => c.region === 'JERUSALEM_SHOMRON',
      (c, a, b) => c.lat > 32.5 ? a.push(c) : b.push(c)
    );
    push2(evaluateClustering(c1, c2, 'North_vs_Jerusalem'));
  }

  if (has('NORTH', 10) && has('SOUTH', 5)) {
    const [c1, c2] = splitByRegion(
      c => c.region === 'NORTH',
      c => c.region === 'SOUTH',
      (c, a, b) => c.lat > 32.2 ? a.push(c) : b.push(c)
    );
    push2(evaluateClustering(c1, c2, 'North_vs_South'));
  }

  if (has('TEL_AVIV_CENTER', 5) && has('JERUSALEM_SHOMRON', 5)) {
    const [c1, c2] = splitByRegion(
      c => c.region === 'TEL_AVIV_CENTER',
      c => c.region === 'JERUSALEM_SHOMRON',
      (c, a, b) => c.lng < 34.95 ? a.push(c) : b.push(c)
    );
    push2(evaluateClustering(c1, c2, 'Coast_vs_Inland'));
  }

  // K-means++ 2-way fallback
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
    push2(evaluateClustering(c1, c2, 'KMeans_LatSplit'));
  }

  // ═══ 3-WAY CANDIDATES ═══

  // North vs Central vs South
  if (has('NORTH', 8) && hasCentral && has('SOUTH', 5)) {
    const gN = [], gC = [], gS = [];
    coords.forEach(c => {
      if (c.region === 'NORTH') gN.push(c);
      else if (c.region === 'TEL_AVIV_CENTER' || c.region === 'JERUSALEM_SHOMRON') gC.push(c);
      else if (c.region === 'SOUTH') gS.push(c);
      else if (c.lat > 32.5) gN.push(c);
      else if (c.lat < 31.5) gS.push(c);
      else gC.push(c);
    });
    push3(evaluateNWayClustering([gN, gC, gS], 'North_Central_South'));
  }

  // North vs Jerusalem/Shomron vs TLV/Center
  if (has('NORTH', 8) && has('JERUSALEM_SHOMRON', 5) && has('TEL_AVIV_CENTER', 5)) {
    const gN = [], gJ = [], gT = [];
    coords.forEach(c => {
      if (c.region === 'NORTH') gN.push(c);
      else if (c.region === 'JERUSALEM_SHOMRON') gJ.push(c);
      else if (c.region === 'TEL_AVIV_CENTER') gT.push(c);
      else if (c.lat > 32.5) gN.push(c);
      else if (c.lng < 34.95) gT.push(c);
      else gJ.push(c);
    });
    push3(evaluateNWayClustering([gN, gJ, gT], 'North_Jerusalem_TelAviv'));
  }

  // K-means 3-way (lat-based seeds: top 10%, middle, bottom 10%)
  {
    const sorted = [...coords].sort((a, b) => a.lat - b.lat);
    const n = Math.max(3, Math.floor(coords.length * 0.1));
    const seeds = [
      centroidOf(sorted.slice(0, n)),
      centroidOf(sorted.slice(Math.floor(sorted.length / 2) - Math.floor(n / 2), Math.floor(sorted.length / 2) + Math.ceil(n / 2))),
      centroidOf(sorted.slice(-n))
    ];
    const groups = [[], [], []];
    coords.forEach(c => {
      const dists = seeds.map(s => haversineKm(c.lat, c.lng, s.lat, s.lng));
      const nearest = dists.indexOf(Math.min(...dists));
      groups[nearest].push(c);
    });
    if (groups.every(g => g.length > 0)) {
      push3(evaluateNWayClustering(groups, 'KMeans3_LatSplit'));
    }
  }

  // ═══ PICK BEST ═══

  // Evaluate 3-way candidates
  let best3 = null;
  const valid3 = candidates3.filter(c => {
    if (!c) return false;
    const allDistinct = new Set(c.groups.map((g) => dominantRegionKey(g))).size >= 2;
    return c.minSeparation >= 40 && c.groups.every(g => g.length >= 5) && c.balance >= 0.03 && allDistinct;
  }).sort((a, b) => b.score - a.score);
  if (valid3.length > 0) best3 = valid3[0];

  // Evaluate 2-way candidates (existing logic)
  const crossRegion = candidates2.filter(c => c.cluster1.regionKey !== c.cluster2.regionKey);
  const bestList2 = (crossRegion.length > 0 ? crossRegion : candidates2).sort((a, b) => b.score - a.score);
  let best2 = bestList2.length > 0 ? bestList2[0] : null;

  // Validate 2-way
  if (best2) {
    const threshold = 60;
    if (!(best2.separation > threshold && best2.cluster2.size >= 10 && best2.balance >= 0.05)) {
      best2 = null;
    }
  }

  // Prefer 3-way if it's strong enough (score bonus for detecting more missiles)
  if (best3 && best2) {
    if (best3.score >= best2.score * 0.6) {
      return buildNWayResult(best3);
    }
  }
  if (best3 && !best2) {
    return buildNWayResult(best3);
  }

  if (best2) {
    return {
      detected: true,
      clusters: [best2.cluster1, best2.cluster2],
      separation: best2.separation,
      balance: best2.balance
    };
  }

  return null;
}

function buildNWayResult(candidate) {
  return {
    detected: true,
    clusters: candidate.groups.map((g, idx) => ({
      cities: g.map(c => c.name),
      center: candidate.centers[idx],
      size: g.length,
      regionKey: dominantRegionKey(g),
      seedName: REGION_NAMES_HE[dominantRegionKey(g)] || dominantRegionKey(g)
    })),
    separation: Math.round(candidate.avgSeparation),
    balance: candidate.balance
  };
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
