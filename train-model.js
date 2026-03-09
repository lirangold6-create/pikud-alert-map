const tf = require('@tensorflow/tfjs');
// Set backend to CPU for server environment
tf.setBackend('cpu');
const fs = require('fs');
const path = require('path');

const WAVES_FILE = path.join(__dirname, 'collected-waves.json');
const RAW_FILE = path.join(__dirname, 'collected-alerts.json');
const CITIES_FILE = path.join(__dirname, 'pikud-haoref-api/cities.json');
const MODEL_DIR = path.join(__dirname, 'model');
const METRICS_FILE = path.join(MODEL_DIR, 'metrics.json');
const NORM_FILE = path.join(MODEL_DIR, 'normalization.json');
const TRAINING_DATA_FILE = path.join(__dirname, 'training-data.json');

const MIN_WAVES = 1;
const VALIDATION_SPLIT = 0.2;
const EPOCHS = 80;
const BATCH_SIZE = 64;
const LEARNING_RATE = 0.001;

const FEATURE_NAMES = [
  'dist_to_center',
  'bearing_sin',
  'bearing_cos',
  'orange_zone_size',
  'city_lat',
  'city_lng',
  'center_lat',
  'center_lng',
  'countdown',
  'hour_sin',
  'hour_cos',
  'city_historical_red_rate'
];

// ── Math utilities ──
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return Math.atan2(y, x);
}

function centroid(coords) {
  if (coords.length === 0) return null;
  const sum = coords.reduce((a, c) => ({ lat: a.lat + c.lat, lng: a.lng + c.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / coords.length, lng: sum.lng / coords.length };
}

// ── Load city metadata ──
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

// ── Feature extraction ──
function extractFeatures(waves) {
  const samples = [];

  // Build historical red rate from all waves
  const cityRedCounts = {};
  const cityWarnCounts = {};
  for (const wave of waves) {
    for (const [city, data] of Object.entries(wave.cities)) {
      const warned = data.orange || data.green;
      if (warned) {
        cityWarnCounts[city] = (cityWarnCounts[city] || 0) + 1;
        if (data.red) cityRedCounts[city] = (cityRedCounts[city] || 0) + 1;
      }
    }
  }

  for (const wave of waves) {
    if (!wave.summary.hasGreen || wave.summary.warned < 5) continue;

    // Warned cities = orange OR green (green is proxy for orange)
    const warnedCities = Object.entries(wave.cities)
      .filter(([, d]) => d.orange || d.green)
      .map(([name]) => name);

    const redCities = Object.entries(wave.cities)
      .filter(([, d]) => d.red)
      .map(([name]) => name);

    // Compute red zone center (or orange centroid as fallback)
    const redCoords = redCities.map(getCityCoords).filter(Boolean);
    const warnedCoords = warnedCities.map(getCityCoords).filter(Boolean);
    const center = redCoords.length > 0 ? centroid(redCoords) : centroid(warnedCoords);
    if (!center) continue;

    const orangeZoneSize = warnedCities.length;
    const hour = new Date(wave.startTime.replace(' ', 'T')).getHours();
    const hourRad = (hour / 24) * 2 * Math.PI;

    for (const cityName of warnedCities) {
      const coords = getCityCoords(cityName);
      if (!coords) continue;

      const dist = haversineKm(coords.lat, coords.lng, center.lat, center.lng);
      const bear = bearing(center.lat, center.lng, coords.lat, coords.lng);
      const countdown = getCityCountdown(cityName);
      const histRate = (cityRedCounts[cityName] || 0) / Math.max(cityWarnCounts[cityName] || 1, 1);
      const gotRed = wave.cities[cityName].red ? 1 : 0;

      samples.push({
        features: [
          dist,
          Math.sin(bear),
          Math.cos(bear),
          orangeZoneSize,
          coords.lat,
          coords.lng,
          center.lat,
          center.lng,
          countdown,
          Math.sin(hourRad),
          Math.cos(hourRad),
          histRate
        ],
        label: gotRed,
        meta: { city: cityName, wave: wave.id, dist }
      });
    }
  }

  return samples;
}

// ── Normalization ──
function computeNormalization(samples) {
  const numFeatures = samples[0].features.length;
  const means = new Array(numFeatures).fill(0);
  const stds = new Array(numFeatures).fill(0);

  for (const s of samples) {
    for (let i = 0; i < numFeatures; i++) means[i] += s.features[i];
  }
  for (let i = 0; i < numFeatures; i++) means[i] /= samples.length;

  for (const s of samples) {
    for (let i = 0; i < numFeatures; i++) stds[i] += (s.features[i] - means[i]) ** 2;
  }
  for (let i = 0; i < numFeatures; i++) stds[i] = Math.sqrt(stds[i] / samples.length) || 1;

  return { means, stds, featureNames: FEATURE_NAMES };
}

function normalize(features, norm) {
  return features.map((f, i) => (f - norm.means[i]) / norm.stds[i]);
}

// ── Model definition ──
function createModel(inputSize) {
  const model = tf.sequential();

  model.add(tf.layers.dense({
    inputShape: [inputSize],
    units: 32,
    activation: 'relu',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
  }));

  model.add(tf.layers.dropout({ rate: 0.3 }));

  model.add(tf.layers.dense({
    units: 16,
    activation: 'relu',
    kernelRegularizer: tf.regularizers.l2({ l2: 0.001 })
  }));

  model.add(tf.layers.dense({
    units: 1,
    activation: 'sigmoid'
  }));

  model.compile({
    optimizer: tf.train.adam(LEARNING_RATE),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });

  return model;
}

// ── Evaluation ──
function evaluate(model, xTest, yTest, norm) {
  const preds = model.predict(xTest);
  const predArr = Array.from(preds.dataSync());
  const labelArr = Array.from(yTest.dataSync());

  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < predArr.length; i++) {
    const pred = predArr[i] >= 0.5 ? 1 : 0;
    const label = labelArr[i];
    if (pred === 1 && label === 1) tp++;
    if (pred === 1 && label === 0) fp++;
    if (pred === 0 && label === 0) tn++;
    if (pred === 0 && label === 1) fn++;
  }

  const accuracy = (tp + tn) / (tp + fp + tn + fn);
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  preds.dispose();
  return { accuracy, precision, recall, f1, tp, fp, tn, fn, totalSamples: predArr.length };
}

// ── Main training pipeline ──
async function main() {
  console.log('=== ML Training Pipeline ===\n');

  // ── Category helpers ──
  function isOrange(title) { return title.includes('בדקות הקרובות'); }
  function isRed(title) { return title.includes('ירי רקטות וטילים') && !title.includes('האירוע הסתיים'); }
  function isGreen(title) { return title.includes('האירוע הסתיים') || title.includes('ניתן לצאת'); }

  function buildWavesFromRaw(rawAlerts) {
    const parsed = rawAlerts
      .map(a => ({ ...a, time: new Date(a.alertDate.replace(' ', 'T')).getTime() }))
      .filter(a => !isNaN(a.time))
      .sort((a, b) => a.time - b.time);

    if (parsed.length === 0) return [];
    const GAP = 20 * 60 * 1000;
    const result = [];
    let curr = [parsed[0]];
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].time - parsed[i - 1].time > GAP) { result.push(curr); curr = []; }
      curr.push(parsed[i]);
    }
    if (curr.length > 0) result.push(curr);

    return result.map(alerts => {
      const cityMap = {};
      for (const a of alerts) {
        if (!cityMap[a.data]) cityMap[a.data] = { orange: false, red: false, green: false, times: {} };
        const e = cityMap[a.data];
        if (isOrange(a.title)) { e.orange = true; e.times.orange = a.alertDate; }
        if (isRed(a.title)) { e.red = true; e.times.red = a.alertDate; }
        if (isGreen(a.title)) { e.green = true; e.times.green = a.alertDate; }
      }
      const warnedCities = Object.keys(cityMap).filter(c => cityMap[c].orange || cityMap[c].green);
      const redCities = Object.keys(cityMap).filter(c => cityMap[c].red);
      return {
        id: 'wave_' + alerts[0].time,
        startTime: alerts[0].alertDate,
        endTime: alerts[alerts.length - 1].alertDate,
        alertCount: alerts.length,
        cities: cityMap,
        summary: {
          warned: warnedCities.length, red: redCities.length,
          conversionRate: warnedCities.length > 0 ? redCities.length / warnedCities.length : 0,
          hasGreen: Object.values(cityMap).some(c => c.green)
        }
      };
    });
  }

  // Load raw data and build waves
  let waves = [];
  if (fs.existsSync(RAW_FILE)) {
    const raw = Object.values(JSON.parse(fs.readFileSync(RAW_FILE, 'utf8')));
    console.log('Raw alerts loaded:', raw.length);
    waves = buildWavesFromRaw(raw);
  }
  if (waves.length === 0 && fs.existsSync(WAVES_FILE)) {
    waves = JSON.parse(fs.readFileSync(WAVES_FILE, 'utf8'));
  }
  if (waves.length === 0) {
    console.log('No alert data found. Run the collector first.');
    process.exit(1);
  }

  const completedWaves = waves.filter(w => w.summary.hasGreen && w.summary.warned > 5);
  console.log(`Total waves: ${waves.length}`);
  console.log(`Completed waves (with green): ${completedWaves.length}`);

  if (completedWaves.length < MIN_WAVES) {
    console.log(`Need at least ${MIN_WAVES} completed wave(s) to train. Currently: ${completedWaves.length}`);
    process.exit(0);
  }

  // Extract features
  console.log('\nExtracting features...');
  const samples = extractFeatures(completedWaves);
  console.log(`Total samples: ${samples.length}`);
  console.log(`  Positive (got red): ${samples.filter(s => s.label === 1).length}`);
  console.log(`  Negative (no red):  ${samples.filter(s => s.label === 0).length}`);

  if (samples.length < 20) {
    console.log('Not enough samples to train. Need at least 20.');
    process.exit(0);
  }

  // Save training data for inspection
  fs.writeFileSync(TRAINING_DATA_FILE, JSON.stringify({
    featureNames: FEATURE_NAMES,
    sampleCount: samples.length,
    positiveCount: samples.filter(s => s.label === 1).length,
    samples: samples.slice(0, 50).map(s => ({
      features: s.features.map(f => Math.round(f * 1000) / 1000),
      label: s.label,
      city: s.meta.city,
      dist: Math.round(s.meta.dist * 10) / 10
    }))
  }, null, 2));

  // Compute normalization
  const norm = computeNormalization(samples);

  // Shuffle and split into train/validation
  const shuffled = [...samples].sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(shuffled.length * (1 - VALIDATION_SPLIT));
  const trainSamples = shuffled.slice(0, splitIdx);
  const valSamples = shuffled.slice(splitIdx);

  console.log(`\nTraining: ${trainSamples.length} samples`);
  console.log(`Validation: ${valSamples.length} samples`);

  // Create tensors
  const xTrain = tf.tensor2d(trainSamples.map(s => normalize(s.features, norm)));
  const yTrain = tf.tensor2d(trainSamples.map(s => [s.label]));
  const xVal = tf.tensor2d(valSamples.map(s => normalize(s.features, norm)));
  const yVal = tf.tensor2d(valSamples.map(s => [s.label]));

  // Handle class imbalance with weights
  const posCount = trainSamples.filter(s => s.label === 1).length;
  const negCount = trainSamples.filter(s => s.label === 0).length;
  const posWeight = negCount / (posCount || 1);
  const classWeights = { 0: 1, 1: Math.min(posWeight, 5) };
  console.log(`Class weights: negative=1.0, positive=${classWeights[1].toFixed(2)}`);

  // Create and train model
  console.log(`\nTraining model (${EPOCHS} epochs)...\n`);
  const model = createModel(FEATURE_NAMES.length);
  model.summary();

  let bestValAcc = 0;
  let bestEpoch = 0;

  const history = await model.fit(xTrain, yTrain, {
    epochs: EPOCHS,
    batchSize: BATCH_SIZE,
    validationData: [xVal, yVal],
    classWeight: classWeights,
    verbose: 0,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if ((epoch + 1) % 10 === 0 || epoch === 0) {
          console.log(`  Epoch ${epoch + 1}: loss=${logs.loss.toFixed(4)} acc=${logs.acc.toFixed(4)} val_loss=${logs.val_loss.toFixed(4)} val_acc=${logs.val_acc.toFixed(4)}`);
        }
        if (logs.val_acc > bestValAcc) {
          bestValAcc = logs.val_acc;
          bestEpoch = epoch + 1;
        }
      }
    }
  });

  console.log(`\nBest validation accuracy: ${(bestValAcc * 100).toFixed(1)}% at epoch ${bestEpoch}`);

  // Evaluate
  console.log('\nEvaluation on validation set:');
  const metrics = evaluate(model, xVal, yVal, norm);
  console.log(`  Accuracy:  ${(metrics.accuracy * 100).toFixed(1)}%`);
  console.log(`  Precision: ${(metrics.precision * 100).toFixed(1)}%`);
  console.log(`  Recall:    ${(metrics.recall * 100).toFixed(1)}%`);
  console.log(`  F1 Score:  ${(metrics.f1 * 100).toFixed(1)}%`);
  console.log(`  TP=${metrics.tp} FP=${metrics.fp} TN=${metrics.tn} FN=${metrics.fn}`);

  // Evaluate on full set too
  const xAll = tf.tensor2d(samples.map(s => normalize(s.features, norm)));
  const yAll = tf.tensor2d(samples.map(s => [s.label]));
  const fullMetrics = evaluate(model, xAll, yAll, norm);

  // Save model
  if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR, { recursive: true });

  await model.save(`file://${MODEL_DIR}`);
  console.log(`\nModel saved to ${MODEL_DIR}`);

  // Save normalization params
  fs.writeFileSync(NORM_FILE, JSON.stringify(norm, null, 2));
  console.log(`Normalization params saved to ${NORM_FILE}`);

  // Compute alpha (blend weight) based on data volume and accuracy
  const waveCount = completedWaves.length;
  let alpha = 0;
  if (waveCount >= 10 && fullMetrics.accuracy >= 0.90) {
    alpha = 0.85;
  } else if (waveCount >= 10 && fullMetrics.accuracy >= 0.80) {
    alpha = 0.70;
  } else if (waveCount >= 3) {
    alpha = Math.min(0.3 + (fullMetrics.accuracy - 0.5) * 0.8, 0.6);
    alpha = Math.max(alpha, 0.2);
  } else {
    alpha = Math.min(waveCount / 5, 0.3) * fullMetrics.accuracy;
  }
  alpha = Math.max(0, Math.min(0.85, alpha));

  // Save metrics
  const metricsData = {
    trainedAt: new Date().toISOString(),
    wavesUsed: completedWaves.length,
    totalSamples: samples.length,
    positiveRate: samples.filter(s => s.label === 1).length / samples.length,
    validation: metrics,
    full: fullMetrics,
    bestValAcc,
    bestEpoch,
    alpha,
    featureNames: FEATURE_NAMES,
    classWeights,
    hyperparams: { epochs: EPOCHS, batchSize: BATCH_SIZE, learningRate: LEARNING_RATE }
  };

  fs.writeFileSync(METRICS_FILE, JSON.stringify(metricsData, null, 2));
  console.log(`Metrics saved to ${METRICS_FILE}`);
  console.log(`\nBlend alpha: ${alpha.toFixed(2)} (${alpha >= 0.8 ? 'trusting ML mostly' : alpha >= 0.4 ? 'blending ML + distance curve' : 'mostly distance curve'})`);

  // Cleanup tensors
  xTrain.dispose(); yTrain.dispose();
  xVal.dispose(); yVal.dispose();
  xAll.dispose(); yAll.dispose();

  console.log('\n=== Training Complete ===');
}

main().catch(err => {
  console.error('Training error:', err.message);
  process.exit(1);
});
