/**
 * Test Prediction Calibration
 * 
 * Loads the trained model and tests predictions against a holdout wave
 * to verify probabilities are well-calibrated
 */

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');

const config = require('../lib/config');
const { haversineKm, bearing, centroid } = require('../lib/utils/geo');

const MODEL_DIR = path.join(__dirname, '..', config.PATHS.MODEL_DIR);
const NORM_FILE = path.join(MODEL_DIR, 'normalization.json');
const WAVES_FILE = path.join(__dirname, '..', config.PATHS.COLLECTED_WAVES);
const CITIES_FILE = path.join(__dirname, '..', config.PATHS.CITIES);
const RATES_FILE = path.join(MODEL_DIR, 'city-historical-rates.json');
const DELAYS_FILE = path.join(MODEL_DIR, 'city-delays.json');

async function main() {
  console.log('=== PREDICTION CALIBRATION TEST ===\n');
  
  // Load model
  const model = await tf.loadLayersModel('file://' + path.join(MODEL_DIR, 'model.json'));
  const norm = JSON.parse(fs.readFileSync(NORM_FILE, 'utf8'));
  const waves = JSON.parse(fs.readFileSync(WAVES_FILE, 'utf8'));
  const cities = JSON.parse(fs.readFileSync(CITIES_FILE, 'utf8'));
  const cityRates = JSON.parse(fs.readFileSync(RATES_FILE, 'utf8'));
  const cityDelays = JSON.parse(fs.readFileSync(DELAYS_FILE, 'utf8'));
  
  const nameToCity = {};
  cities.forEach(c => { nameToCity[c.name] = c; });
  
  function getCityCoords(name) {
    const c = nameToCity[name];
    return (c && c.lat && c.lng) ? { lat: c.lat, lng: c.lng } : null;
  }
  
  // Take last 5 completed waves as test set
  const completedWaves = waves.filter(w => w.summary && w.summary.hasGreen && w.summary.warned >= 5);
  const testWaves = completedWaves.slice(-5);
  
  console.log('Testing on last 5 completed waves\n');
  
  // Collect predictions vs actuals
  const predictionBuckets = {
    '90-100%': {predicted: [], actual: []},
    '80-90%': {predicted: [], actual: []},
    '70-80%': {predicted: [], actual: []},
    '60-70%': {predicted: [], actual: []},
    '50-60%': {predicted: [], actual: []},
    '40-50%': {predicted: [], actual: []},
    '30-40%': {predicted: [], actual: []},
    '20-30%': {predicted: [], actual: []},
    '10-20%': {predicted: [], actual: []},
    '0-10%': {predicted: [], actual: []}
  };
  
  for (const wave of testWaves) {
    const warnedCities = Object.entries(wave.cities)
      .filter(([, d]) => d.orange || d.green)
      .map(([name]) => name);

    const redCities = Object.entries(wave.cities)
      .filter(([, d]) => d.red)
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
    
    if (!center || warnedCities.length === 0) continue;
    
    // Make predictions for warned cities
    const features = [];
    const validCities = [];
    const hour = new Date(wave.startTime.replace(' ', 'T')).getHours();
    const hourRad = (hour / 24) * 2 * Math.PI;
    
    for (const cityName of warnedCities) {
      const city = nameToCity[cityName];
      if (!city || !city.lat || !city.lng) continue;
      
      const dist = haversineKm(city.lat, city.lng, center.lat, center.lng);
      const bear = bearing(center.lat, center.lng, city.lat, city.lng) * Math.PI / 180;
      const countdown = city.countdown || 0;
      const histRate = cityRates[cityName] || 0.44;
      const avgDelay = cityDelays[cityName] || 0;
      
      features.push([
        dist,
        Math.sin(bear),
        Math.cos(bear),
        city.lat,
        city.lng,
        center.lat,
        center.lng,
        countdown,
        Math.sin(hourRad),
        Math.cos(hourRad),
        histRate,
        0,  // warning delay (0 at inference time)
        avgDelay,
        0,  // multi_missile_detected (0 for test - single missile assumption)
        0,  // cluster_separation_km (0 for test)
        0,  // gap_orange_percentage (0 for test)
        0   // city_in_minority_cluster (0 for test)
      ]);
      validCities.push(cityName);
    }
    
    if (features.length === 0) continue;
    
    // Normalize and predict
    const normalized = features.map(f =>
      f.map((v, i) => (v - norm.means[i]) / norm.stds[i])
    );
    
    const inputTensor = tf.tensor2d(normalized);
    const predictions = model.predict(inputTensor);
    const predArray = Array.from(await predictions.data());
    
    inputTensor.dispose();
    predictions.dispose();
    
    // Categorize predictions
    validCities.forEach((cityName, i) => {
      const mlProb = predArray[i] * 100;
      const gotRed = wave.cities[cityName].red ? 1 : 0;
      
      // Find bucket
      for (const [bucketName, bucket] of Object.entries(predictionBuckets)) {
        const [min, max] = bucketName.split('-').map(s => parseInt(s.replace('%', '')));
        if (mlProb >= min && mlProb < max) {
          bucket.predicted.push(mlProb);
          bucket.actual.push(gotRed);
          break;
        }
      }
    });
  }
  
  // Display calibration table
  console.log('\n=== PROBABILITY CALIBRATION RESULTS ===\n');
  console.log('Pred Range | Count | Actual Red Rate | Expected  | Calibrated?');
  console.log('-----------|-------|-----------------|-----------|------------');
  
  for (const [bucketName, bucket] of Object.entries(predictionBuckets)) {
    if (bucket.predicted.length === 0) continue;
    
    const actualRate = (bucket.actual.filter(a => a === 1).length / bucket.actual.length * 100);
    const [min, max] = bucketName.split('-').map(s => parseInt(s.replace('%', '')));
    const expectedMid = (min + max) / 2;
    const gap = Math.abs(actualRate - expectedMid);
    const calibrated = gap < 15 ? '✅ Yes' : gap < 25 ? '⚠️  Fair' : '❌ No';
    
    console.log(`${bucketName.padEnd(10)} | ${bucket.predicted.length.toString().padStart(5)} | ${actualRate.toFixed(1).padStart(15)}% | ${expectedMid.toFixed(0).padStart(9)}% | ${calibrated}`);
  }
  
  console.log('\n📊 A well-calibrated model should have actual rates close to expected rates.');
  console.log('Large gaps indicate over/under-estimation.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
