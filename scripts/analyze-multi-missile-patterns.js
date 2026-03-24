const fs = require('fs');
const { getCityRegion } = require('../lib/utils/regions');
const { haversineKm } = require('../lib/utils/geo');
const cities = require('../pikud-haoref-api/cities.json');

const nameToCity = {};
cities.forEach(c => { nameToCity[c.name] = c; });

// Load all alerts
const alertsObj = JSON.parse(fs.readFileSync('data/collected-alerts.json', 'utf-8'));
const alerts = Object.values(alertsObj);

// Group by wave time (orange alert time)
const wavesByTime = {};
alerts.filter(a => (a.title || '').includes('בדקות')).forEach(a => {
  const time = a.alertDate.substring(0, 16); // YYYY-MM-DD HH:MM
  if (!wavesByTime[time]) wavesByTime[time] = { orangeAlerts: [] };
  wavesByTime[time].orangeAlerts.push(a);
});

// For each wave, find associated reds (within 10 minutes)
for (const [waveTime, waveData] of Object.entries(wavesByTime)) {
  const waveMs = new Date(waveTime + ':00').getTime();
  waveData.redAlerts = alerts.filter(a => {
    if (!(a.title || '').includes('ירי רקטות')) return false;
    const redMs = new Date(a.alertDate).getTime();
    return redMs >= waveMs && redMs < waveMs + 15 * 60 * 1000; // 15 min window
  });
}

// Filter to waves with both oranges and reds
const completeWaves = Object.entries(wavesByTime)
  .filter(([_, data]) => data.orangeAlerts.length >= 10 && data.redAlerts.length >= 3)
  .map(([time, data]) => {
    const orangeCities = [...new Set(data.orangeAlerts.map(a => a.data))];
    const redCities = [...new Set(data.redAlerts.map(a => a.data))];
    return { time, orangeCities, redCities };
  })
  .sort((a, b) => a.time.localeCompare(b.time));

console.log('Total complete waves to analyze:', completeWaves.length);
console.log('Analyzing...\n');

// Analyze each wave for multi-missile signatures
const analysis = [];

for (const wave of completeWaves) {
  const redCoords = wave.redCities.map(name => {
    const city = nameToCity[name];
    return city && city.lat != null ? { name, lat: city.lat, lng: city.lng, region: getCityRegion(name, nameToCity) } : null;
  }).filter(x => x);
  
  if (redCoords.length < 3) continue;
  
  // Calculate overall center
  const centerLat = redCoords.reduce((s, c) => s + c.lat, 0) / redCoords.length;
  const centerLng = redCoords.reduce((s, c) => s + c.lng, 0) / redCoords.length;
  
  // Measure spread
  const distances = redCoords.map(c => haversineKm(c.lat, c.lng, centerLat, centerLng));
  const maxDist = Math.max(...distances);
  const avgDist = distances.reduce((s, d) => s + d, 0) / distances.length;
  const p90Dist = distances.sort((a, b) => a - b)[Math.floor(distances.length * 0.9)];
  
  // Regional distribution of reds
  const redByRegion = {};
  redCoords.forEach(c => {
    if (!redByRegion[c.region]) redByRegion[c.region] = 0;
    redByRegion[c.region]++;
  });
  
  const regionCounts = Object.values(redByRegion);
  const majorRegions = regionCounts.filter(c => c >= 10).length;
  
  // Entropy measure - higher = more spread out
  const total = redCoords.length;
  const entropy = -Object.values(redByRegion).reduce((sum, count) => {
    const p = count / total;
    return sum + (p > 0 ? p * Math.log2(p) : 0);
  }, 0);
  
  analysis.push({
    time: wave.time,
    orangeCount: wave.orangeCities.length,
    redCount: wave.redCities.length,
    maxDist,
    avgDist,
    p90Dist,
    majorRegions,
    entropy,
    regionCounts: redByRegion
  });
}

console.log('=== MULTI-MISSILE DETECTION PATTERNS ===\n');

// Sort by various metrics to find thresholds
const byMaxDist = [...analysis].sort((a, b) => b.maxDist - a.maxDist);
const byEntropy = [...analysis].sort((a, b) => b.entropy - a.entropy);
const byRegions = [...analysis].sort((a, b) => b.majorRegions - a.majorRegions);

console.log('TOP 15 WAVES BY MAX SPREAD:\n');
byMaxDist.slice(0, 15).forEach((w, i) => {
  console.log((i+1) + '. ' + w.time + ':');
  console.log('   Spread: max=' + w.maxDist.toFixed(0) + 'km, avg=' + w.avgDist.toFixed(0) + 'km, p90=' + w.p90Dist.toFixed(0) + 'km');
  console.log('   Regions:', w.majorRegions, 'major | Entropy:', w.entropy.toFixed(2));
  console.log('   Distribution:', Object.entries(w.regionCounts).sort((a,b) => b[1] - a[1]).map(([r, c]) => r + ':' + c).join(', '));
  console.log('');
});

console.log('\n=== STATISTICAL THRESHOLDS ===\n');

// Calculate percentiles
const maxDistSorted = analysis.map(w => w.maxDist).sort((a, b) => a - b);
const entropySorted = analysis.map(w => w.entropy).sort((a, b) => a - b);
const regionsSorted = analysis.map(w => w.majorRegions).sort((a, b) => a - b);

const p50MaxDist = maxDistSorted[Math.floor(maxDistSorted.length * 0.5)];
const p75MaxDist = maxDistSorted[Math.floor(maxDistSorted.length * 0.75)];
const p90MaxDist = maxDistSorted[Math.floor(maxDistSorted.length * 0.9)];

const p50Entropy = entropySorted[Math.floor(entropySorted.length * 0.5)];
const p75Entropy = entropySorted[Math.floor(entropySorted.length * 0.75)];
const p90Entropy = entropySorted[Math.floor(entropySorted.length * 0.9)];

console.log('Max Distance (km):');
console.log('  50th percentile:', p50MaxDist.toFixed(1));
console.log('  75th percentile:', p75MaxDist.toFixed(1));
console.log('  90th percentile:', p90MaxDist.toFixed(1));
console.log('');

console.log('Entropy (regional spread):');
console.log('  50th percentile:', p50Entropy.toFixed(2));
console.log('  75th percentile:', p75Entropy.toFixed(2));
console.log('  90th percentile:', p90Entropy.toFixed(2));
console.log('');

console.log('Major regions with 10+ reds:');
console.log('  Mode:', regionsSorted[Math.floor(regionsSorted.length / 2)]);
console.log('  75th percentile:', regionsSorted[Math.floor(regionsSorted.length * 0.75)]);
console.log('');

// Identify likely multi-missile waves
const likelyMulti = analysis.filter(w => 
  (w.maxDist > 100 && w.majorRegions >= 3) || 
  (w.entropy > 2.0 && w.majorRegions >= 3)
);

console.log('=== LIKELY MULTI-MISSILE WAVES ===');
console.log('Found:', likelyMulti.length, 'out of', analysis.length, 'total waves');
console.log('Criteria: maxDist > 100km AND 3+ major regions, OR entropy > 2.0 AND 3+ major regions\n');

likelyMulti.slice(0, 10).forEach(w => {
  console.log(w.time + ':');
  console.log('  ' + w.redCount + ' reds, spread=' + w.maxDist.toFixed(0) + 'km, regions=' + w.majorRegions + ', entropy=' + w.entropy.toFixed(2));
  console.log('  ' + Object.entries(w.regionCounts).sort((a,b) => b[1] - a[1]).map(([r, c]) => r.substring(0,10) + ':' + c).join(', '));
});

// Save detailed analysis
const output = {
  totalWaves: analysis.length,
  multiMissileCount: likelyMulti.length,
  thresholds: {
    maxDist: { p50: p50MaxDist, p75: p75MaxDist, p90: p90MaxDist },
    entropy: { p50: p50Entropy, p75: p75Entropy, p90: p90Entropy }
  },
  waves: analysis
};

fs.writeFileSync('data/multi-missile-analysis.json', JSON.stringify(output, null, 2));
console.log('\n✓ Saved detailed analysis to data/multi-missile-analysis.json');
