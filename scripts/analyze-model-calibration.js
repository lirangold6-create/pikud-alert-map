/**
 * Deep Model Calibration Analysis
 * 
 * This script analyzes:
 * 1. Distance curve calibration
 * 2. Probability calibration (do 70% predictions actually hit 70%?)
 * 3. Feature importance and potential data leakage
 * 4. Optimal probability curves based on actual data
 */

const fs = require('fs');
const path = require('path');

const config = require('../lib/config');
const { haversineKm, bearing, centroid } = require('../lib/utils/geo');
const { isOrange, isRed, isGreen } = require('../lib/utils/alerts');

const WAVES_FILE = path.join(__dirname, '..', config.PATHS.COLLECTED_WAVES);
const CITIES_FILE = path.join(__dirname, '..', config.PATHS.CITIES);

// Load data
const waves = JSON.parse(fs.readFileSync(WAVES_FILE, 'utf8'));
const cities = JSON.parse(fs.readFileSync(CITIES_FILE, 'utf8'));

const nameToCity = {};
cities.forEach(c => { nameToCity[c.name] = c; });

function getCityCoords(name) {
  const c = nameToCity[name];
  return (c && c.lat && c.lng) ? { lat: c.lat, lng: c.lng } : null;
}

function getCityCountdown(name) {
  const c = nameToCity[name];
  return c ? (c.countdown || 0) : 0;
}

function distToProb(distKm) {
  const curve = config.PROB_CURVE;
  if (distKm <= curve[0].dist) return curve[0].prob;
  if (distKm >= curve[curve.length - 1].dist) return curve[curve.length - 1].prob;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (distKm >= a.dist && distKm <= b.dist) {
      const t = (distKm - a.dist) / (b.dist - a.dist);
      return a.prob + t * (b.prob - a.prob);
    }
  }
  return 0;
}

console.log('=== COMPREHENSIVE MODEL CALIBRATION ANALYSIS ===\n');
console.log('Total waves:', waves.length);

// Filter to completed waves (with green cities indicating wave ended)
const completedWaves = waves.filter(w => {
  return w.summary && w.summary.hasGreen && w.summary.warned >= 5;
});

console.log('Completed waves (with green, 5+ warned):', completedWaves.length);
console.log('');

// Extract all samples manually
const allSamples = [];

for (const wave of completedWaves) {
  const warnedCities = Object.entries(wave.cities)
    .filter(([, d]) => d.orange || d.green)
    .map(([name]) => name);

  const redCities = Object.entries(wave.cities)
    .filter(([, d]) => d.red)
    .map(([name]) => name);
    
  const greenCities = Object.entries(wave.cities)
    .filter(([, d]) => d.green)
    .map(([name]) => name);

  const redCoords = redCities.map(getCityCoords).filter(Boolean);
  const warnedCoords = warnedCities.map(getCityCoords).filter(Boolean);
  
  // Use RED center ONLY if close to orange cities (same attack)
  let center;
  if (redCoords.length > 0) {
    const redCenter = centroid(redCoords);
    const orangeCoords = warnedCities
      .filter(name => !redCities.includes(name)) // Pure orange only
      .map(getCityCoords)
      .filter(Boolean);
    
    if (orangeCoords.length > 0) {
      const orangeCenter = centroid(orangeCoords);
      const distBetweenCenters = haversineKm(redCenter.lat, redCenter.lng, orangeCenter.lat, orangeCenter.lng);
      
      if (distBetweenCenters < 80) {
        center = redCenter; // Same attack
      } else {
        center = orangeCenter; // Different attack
      }
    } else {
      center = redCenter;
    }
  } else {
    center = centroid(warnedCoords);
  }
  
  if (!center) continue;

  for (const cityName of warnedCities) {
    const coords = getCityCoords(cityName);
    if (!coords) continue;

    const dist = haversineKm(coords.lat, coords.lng, center.lat, center.lng);
    const gotRed = wave.cities[cityName].red ? 1 : 0;
    
    // Distance to nearest green
    let distToNearestGreen = 999;
    let greenWithin15km = 0;
    for (const greenCity of greenCities) {
      const greenCoords = getCityCoords(greenCity);
      if (!greenCoords) continue;
      const distToGreen = haversineKm(coords.lat, coords.lng, greenCoords.lat, greenCoords.lng);
      if (distToGreen < distToNearestGreen) distToNearestGreen = distToGreen;
      if (distToGreen <= 15) greenWithin15km++;
    }

    allSamples.push({
      city: cityName,
      wave: wave.startTime,
      dist,
      gotRed,
      greenCount: greenCities.length,
      distToGreen: distToNearestGreen,
      greenWithin15km
    });
  }
}

console.log('Total samples extracted:', allSamples.length);
console.log('Red alerts:', allSamples.filter(s => s.gotRed).length);
console.log('Base rate:', (allSamples.filter(s => s.gotRed).length / allSamples.length * 100).toFixed(1) + '%\n');

// === DISTANCE CURVE CALIBRATION ===
console.log('=== DISTANCE CURVE vs ACTUAL RESULTS ===\n');
console.log('Distance | Samples | RED    | Actual % | Curve % | Gap');
console.log('---------|---------|--------|----------|---------|-------------');

const buckets = [
  {name: '0-15km', min: 0, max: 15, mid: 7.5},
  {name: '15-20km', min: 15, max: 20, mid: 17.5},
  {name: '20-25km', min: 20, max: 25, mid: 22.5},
  {name: '25-30km', min: 25, max: 30, mid: 27.5},
  {name: '30-40km', min: 30, max: 40, mid: 35},
  {name: '40-50km', min: 40, max: 50, mid: 45},
  {name: '50-60km', min: 50, max: 60, mid: 55},
  {name: '60-80km', min: 60, max: 80, mid: 70},
  {name: '80-100km', min: 80, max: 100, mid: 90},
  {name: '100+km', min: 100, max: 999, mid: 120}
];

let totalWeightedGap = 0;
buckets.forEach(b => {
  const inRange = allSamples.filter(s => s.dist >= b.min && s.dist < b.max);
  const redCount = inRange.filter(s => s.gotRed).length;
  const actualRate = inRange.length > 0 ? (redCount / inRange.length * 100) : 0;
  const curveRate = distToProb(b.mid);
  const gap = curveRate - actualRate;
  
  if (inRange.length > 0) {
    totalWeightedGap += gap * inRange.length;
    const gapStr = gap > 0 ? '+' + gap.toFixed(1) : gap.toFixed(1);
    const warning = Math.abs(gap) > 20 ? ' ⚠️' : '';
    console.log(`${b.name.padEnd(8)} | ${inRange.length.toString().padStart(7)} | ${redCount.toString().padStart(6)} | ${actualRate.toFixed(1).padStart(8)}% | ${curveRate.toFixed(1).padStart(7)}% | ${gapStr.padStart(11)}%${warning}`);
  }
});

const avgGap = totalWeightedGap / allSamples.length;
console.log('');
console.log('WEIGHTED AVERAGE GAP:', avgGap > 0 ? '+' + avgGap.toFixed(1) : avgGap.toFixed(1), '%');

if (avgGap > 10) {
  console.log('');
  console.log('🚨 CRITICAL: Distance curve OVERESTIMATES by ' + avgGap.toFixed(1) + '%!');
} else if (avgGap < -10) {
  console.log('');
  console.log('⚠️  WARNING: Distance curve UNDERESTIMATES by ' + Math.abs(avgGap).toFixed(1) + '%');
}

// === GREEN ZONE ANALYSIS ===
console.log('\n\n=== GREEN ZONE DATA LEAKAGE CHECK ===\n');

const withGreen = allSamples.filter(s => s.greenWithin15km > 0);
const withoutGreen = allSamples.filter(s => s.greenWithin15km === 0);

console.log('Samples with green cities within 15km:', withGreen.length);
console.log('  Red rate:', (withGreen.filter(s => s.gotRed).length / withGreen.length * 100).toFixed(1) + '%');
console.log('');
console.log('Samples without green cities within 15km:', withoutGreen.length);
console.log('  Red rate:', (withoutGreen.filter(s => s.gotRed).length / withoutGreen.length * 100).toFixed(1) + '%');
console.log('');

const baseRate = allSamples.filter(s => s.gotRed).length / allSamples.length;
const withGreenRate = withGreen.filter(s => s.gotRed).length / withGreen.length;
const withoutGreenRate = withoutGreen.filter(s => s.gotRed).length / withoutGreen.length;

if (Math.abs(withGreenRate - baseRate) > 0.05 || Math.abs(withoutGreenRate - baseRate) > 0.05) {
  console.log('⚠️  GREEN ZONE FEATURES ARE LEAKING INFORMATION!');
  console.log('Cities near green zones have different red rates than base rate.');
  console.log('This inflates probabilities during live predictions.');
}

// === OPTIMAL CURVE CALCULATION ===
console.log('\n\n=== SUGGESTED DISTANCE CURVE (DATA-DRIVEN) ===\n');

const distPoints = [0, 5, 10, 15, 17, 20, 25, 30, 40, 50, 60, 80, 100];

console.log('Dist | Samples | Actual Rate | Current | Suggested');
console.log('-----|---------|-------------|---------|----------');

distPoints.forEach(dist => {
  // Get samples within ±3km of this distance
  const nearby = allSamples.filter(s => Math.abs(s.dist - dist) <= 3);
  const redCount = nearby.filter(s => s.gotRed).length;
  const rate = nearby.length > 0 ? (redCount / nearby.length * 100) : null;
  
  const currentProb = distToProb(dist);
  const suggested = rate !== null ? Math.round(rate / 5) * 5 : null; // Round to nearest 5%
  
  if (nearby.length >= 10) {  // Only show if we have enough samples
    console.log(`${dist.toString().padStart(4)} | ${nearby.length.toString().padStart(7)} | ${rate.toFixed(1).padStart(11)}% | ${currentProb.toFixed(0).padStart(7)}% | ${suggested !== null ? suggested.toString().padStart(9) + '%' : '      -'}`);
  }
});

console.log('\n=== RECOMMENDATIONS ===\n');
console.log('1. Update PROB_CURVE in lib/config.js with data-driven values');
console.log('2. Consider removing or re-engineering green zone features');
console.log('3. Lower alpha if distance curve is more reliable');
console.log('4. Implement proper probability calibration (e.g., isotonic regression)');
