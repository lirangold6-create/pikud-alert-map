const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');

const config = require('../lib/config');
const { haversineKm, centroid } = require('../lib/utils/geo');
const { isOrange, isRed, isGreen } = require('../lib/utils/alerts');
const { buildWaves: buildWavesUtil } = require('../lib/utils/waves');
const { detectMultiMissile, getRelevantCenter } = require('../lib/utils/multi-missile');
const { extractFeatures: extractCityFeatures, getFeatureNames } = require('../lib/ml/features');

const WAVES_FILE = path.join(__dirname, '..', config.PATHS.COLLECTED_WAVES);
const RAW_FILE = path.join(__dirname, '..', config.PATHS.COLLECTED_ALERTS);
const CITIES_FILE = path.join(__dirname, '..', config.PATHS.CITIES);
const MODEL_DIR = path.join(__dirname, '..', config.PATHS.MODEL_DIR);
const METRICS_FILE = path.join(MODEL_DIR, 'metrics.json');
const NORM_FILE = path.join(MODEL_DIR, 'normalization.json');
const TRAINING_DATA_FILE = path.join(__dirname, '..', config.PATHS.TRAINING_DATA);

const MODEL_HISTORY_DIR = path.join(MODEL_DIR, 'history');
const MAX_MODEL_HISTORY = config.MAX_MODEL_HISTORY;
const MIN_WAVES = 1;

// Recency weighting: recent waves matter more than old ones.
// weight = 1 + RECENCY_BOOST * exp(-ageDays / RECENCY_HALFLIFE)
// With defaults: a wave from today gets weight ~3.0, 7 days ago ~1.7, 14 days ~1.2, 30+ days ~1.0
const RECENCY_BOOST = 2.0;
const RECENCY_HALFLIFE = 7; // days

function recencyWeight(waveTimeStr) {
  const waveTime = new Date(waveTimeStr.replace(' ', 'T')).getTime();
  const ageDays = (Date.now() - waveTime) / (24 * 3600 * 1000);
  return 1 + RECENCY_BOOST * Math.exp(-ageDays / RECENCY_HALFLIFE);
}
const VALIDATION_SPLIT = config.VALIDATION_SPLIT;
const EPOCHS = config.EPOCHS;
const BATCH_SIZE = config.BATCH_SIZE;
const LEARNING_RATE = config.LEARNING_RATE;
const FEATURE_NAMES = getFeatureNames();

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

// ── Feature extraction (delegates per-city work to lib/ml/features.js) ──
function extractFeatures(waves) {
  const samples = [];

  // Build historical red rate and delay data from all waves (recency-weighted)
  const cityRedWeights = {};
  const cityWarnWeights = {};
  const cityOrangeToRedDelays = {};

  for (const wave of waves) {
    const w = recencyWeight(wave.startTime);
    for (const [city, data] of Object.entries(wave.cities)) {
      const warned = data.orange || data.green;
      if (warned) {
        cityWarnWeights[city] = (cityWarnWeights[city] || 0) + w;
        if (data.red) cityRedWeights[city] = (cityRedWeights[city] || 0) + w;

        if (data.times && data.times.orange && data.times.red) {
          const orangeTime = new Date(data.times.orange.replace(' ', 'T')).getTime();
          const redTime = new Date(data.times.red.replace(' ', 'T')).getTime();
          const delayMin = (redTime - orangeTime) / 60000;
          if (delayMin > 0 && delayMin < 60) {
            if (!cityOrangeToRedDelays[city]) cityOrangeToRedDelays[city] = [];
            cityOrangeToRedDelays[city].push(delayMin);
          }
        }
      }
    }
  }

  const cityAvgDelay = {};
  for (const [city, delays] of Object.entries(cityOrangeToRedDelays)) {
    cityAvgDelay[city] = delays.reduce((a, b) => a + b, 0) / delays.length;
  }

  const cityHistoricalRates = {};
  for (const city of Object.keys(cityWarnWeights)) {
    cityHistoricalRates[city] = (cityRedWeights[city] || 0) / Math.max(cityWarnWeights[city] || 1, 1);
  }

  for (const wave of waves) {
    if (!wave.summary.hasGreen || wave.summary.warned < 5) continue;

    const warnedCities = Object.entries(wave.cities)
      .filter(([, d]) => d.orange || d.green)
      .map(([name]) => name);

    const redCities = Object.entries(wave.cities)
      .filter(([, d]) => d.red)
      .map(([name]) => name);

    // Compute center - use RED only if close to oranges (same attack)
    const redCoords = redCities.map(getCityCoords).filter(Boolean);
    const warnedCoords = warnedCities.map(getCityCoords).filter(Boolean);

    let center;
    if (redCoords.length > 0) {
      const redCenter = centroid(redCoords);
      const orangeCoords = warnedCities
        .filter(name => !redCities.includes(name))
        .map(getCityCoords)
        .filter(Boolean);

      if (orangeCoords.length > 0) {
        const orangeCenter = centroid(orangeCoords);
        const distBetweenCenters = haversineKm(redCenter.lat, redCenter.lng, orangeCenter.lat, orangeCenter.lng);
        if (distBetweenCenters < 80) {
          center = redCenter;
        } else {
          center = orangeCenter;
          console.log(`[Training] Wave ${wave.id}: RED too far (${distBetweenCenters.toFixed(1)}km) - using ORANGE center`);
        }
      } else {
        center = redCenter;
      }
    } else {
      center = centroid(warnedCoords);
    }

    if (!center) continue;

    const hour = new Date(wave.startTime.replace(' ', 'T')).getHours();
    const firstOrangeTime = new Date(wave.startTime.replace(' ', 'T')).getTime();
    const multiMissileInfo = detectMultiMissile(redCities, nameToCity);

    for (const cityName of warnedCities) {
      const city = nameToCity[cityName];
      if (!city || !city.lat || !city.lng) continue;

      const cityData = wave.cities[cityName];
      const cityOrangeTime = cityData.times && cityData.times.orange
        ? new Date(cityData.times.orange.replace(' ', 'T')).getTime()
        : firstOrangeTime;
      const warningDelayMinutes = (cityOrangeTime - firstOrangeTime) / 60000;
      const gotRed = cityData.red ? 1 : 0;

      // Use shared feature extraction (single source of truth)
      const features = extractCityFeatures({
        city,
        center,
        hour,
        cityRates: cityHistoricalRates,
        cityDelays: cityAvgDelay,
        warningDelayMinutes,
        multiMissileInfo,
        orangeCities: warnedCities,
        nameToCity
      });

      const dist = haversineKm(city.lat, city.lng, center.lat, center.lng);
      const sampleWeight = recencyWeight(wave.startTime);

      samples.push({
        features,
        label: gotRed,
        sampleWeight,
        meta: { city: cityName, wave: wave.id, dist, delay: warningDelayMinutes, avgDelayToRed: cityAvgDelay[cityName] || 0, multiMissile: multiMissileInfo && multiMissileInfo.detected ? 1 : 0 }
      });
    }
  }

  // Build attack-size-conditional rates (recency-weighted)
  const SIZE_THRESHOLD = 100;
  const MIN_SAMPLES = 5;
  const condData = {};
  for (const wave of waves) {
    const w = recencyWeight(wave.startTime);
    const waveSize = Object.values(wave.cities).filter(d => d.orange || d.green).length;
    const isSmall = waveSize < SIZE_THRESHOLD;
    for (const [city, data] of Object.entries(wave.cities)) {
      if (!(data.orange || data.green)) continue;
      if (!condData[city]) condData[city] = { sW: 0, sR: 0, lW: 0, lR: 0, sN: 0, lN: 0 };
      if (isSmall) { condData[city].sW += w; if (data.red) condData[city].sR += w; condData[city].sN++; }
      else { condData[city].lW += w; if (data.red) condData[city].lR += w; condData[city].lN++; }
    }
  }
  const cityConditionalRates = {};
  for (const [city, d] of Object.entries(condData)) {
    cityConditionalRates[city] = {
      overall: cityHistoricalRates[city] || 0,
      small: d.sN >= MIN_SAMPLES ? d.sR / d.sW : null,
      large: d.lN >= MIN_SAMPLES ? d.lR / d.lW : null,
      smallN: d.sN, largeN: d.lN
    };
  }

  return { samples, cityAvgDelay, cityHistoricalRates, cityConditionalRates };
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
    kernelRegularizer: tf.regularizers.l2({ l2: config.L2_REGULARIZATION })
  }));

  model.add(tf.layers.dropout({ rate: config.DROPOUT_RATE }));

  model.add(tf.layers.dense({
    units: 16,
    activation: 'relu',
    kernelRegularizer: tf.regularizers.l2({ l2: config.L2_REGULARIZATION })
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

// ── Model versioning ──
const MODEL_FILES = ['model.json', 'weights.bin', 'metrics.json', 'normalization.json', 'city-delays.json', 'city-historical-rates.json', 'city-conditional-rates.json'];

function snapshotCurrentModel() {
  // Check if there's a current model to snapshot
  if (!fs.existsSync(path.join(MODEL_DIR, 'model.json'))) return null;
  if (!fs.existsSync(path.join(MODEL_DIR, 'metrics.json'))) return null;

  // Read current metrics for the snapshot label
  let currentMetrics;
  try {
    currentMetrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
  } catch { return null; }

  const timestamp = currentMetrics.trainedAt
    ? currentMetrics.trainedAt.replace(/[:.]/g, '-')
    : new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = path.join(MODEL_HISTORY_DIR, timestamp);

  if (!fs.existsSync(MODEL_HISTORY_DIR)) fs.mkdirSync(MODEL_HISTORY_DIR, { recursive: true });
  if (fs.existsSync(snapshotDir)) return snapshotDir; // Already snapshotted

  fs.mkdirSync(snapshotDir, { recursive: true });

  for (const file of MODEL_FILES) {
    const src = path.join(MODEL_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(snapshotDir, file));
    }
  }

  console.log(`[Versioning] Snapshotted current model to ${path.relative(process.cwd(), snapshotDir)}`);
  return snapshotDir;
}

function rollbackModel(snapshotDir) {
  console.log(`[Versioning] Rolling back to ${path.basename(snapshotDir)}...`);
  for (const file of MODEL_FILES) {
    const src = path.join(snapshotDir, file);
    const dst = path.join(MODEL_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }
  console.log('[Versioning] Rollback complete - previous model restored');
}

function pruneModelHistory() {
  if (!fs.existsSync(MODEL_HISTORY_DIR)) return;

  const entries = fs.readdirSync(MODEL_HISTORY_DIR)
    .filter(d => fs.statSync(path.join(MODEL_HISTORY_DIR, d)).isDirectory())
    .sort(); // Timestamps sort chronologically

  while (entries.length > MAX_MODEL_HISTORY) {
    const oldest = entries.shift();
    const dirPath = path.join(MODEL_HISTORY_DIR, oldest);
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`[Versioning] Pruned old snapshot: ${oldest}`);
  }
}

// ── Main training pipeline ──
async function main() {
  console.log('=== ML Training Pipeline ===\n');

  // Use shared wave building utility
  function buildWavesFromRaw(rawAlerts) {
    return buildWavesUtil(rawAlerts, config.WAVE_GAP_MS);
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
  const { samples, cityAvgDelay, cityHistoricalRates, cityConditionalRates } = extractFeatures(completedWaves);
  console.log(`Total samples: ${samples.length}`);
  console.log(`  Positive (got red): ${samples.filter(s => s.label === 1).length}`);
  console.log(`  Negative (no red):  ${samples.filter(s => s.label === 0).length}`);
  console.log(`  Cities with avg delay data: ${Object.keys(cityAvgDelay).length}`);

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

  // Recency-weighted oversampling: duplicate recent samples proportionally.
  // A sample with weight 2.5 appears once guaranteed + 50% chance of a second copy.
  const avgRecency = trainSamples.reduce((s, x) => s + x.sampleWeight, 0) / trainSamples.length;
  console.log(`Recency weights: avg=${avgRecency.toFixed(2)}, min=${Math.min(...trainSamples.map(s => s.sampleWeight)).toFixed(2)}, max=${Math.max(...trainSamples.map(s => s.sampleWeight)).toFixed(2)}`);
  
  const oversampledTrain = [];
  for (const s of trainSamples) {
    const w = s.sampleWeight;
    const copies = Math.floor(w);
    const fractional = w - copies;
    for (let i = 0; i < copies; i++) oversampledTrain.push(s);
    if (Math.random() < fractional) oversampledTrain.push(s);
  }
  const oversampled = oversampledTrain.sort(() => Math.random() - 0.5);
  console.log(`Oversampled training: ${trainSamples.length} → ${oversampled.length} samples (+${((oversampled.length / trainSamples.length - 1) * 100).toFixed(0)}%)`);

  // Handle class imbalance with weights
  const posCount = oversampled.filter(s => s.label === 1).length;
  const negCount = oversampled.filter(s => s.label === 0).length;
  const posWeight = negCount / (posCount || 1);
  const classWeights = { 0: 1, 1: Math.min(posWeight, 5) };
  console.log(`Class weights: negative=1.0, positive=${classWeights[1].toFixed(2)}`);

  // Create tensors (using oversampled training data)
  const xTrain = tf.tensor2d(oversampled.map(s => normalize(s.features, norm)));
  const yTrain = tf.tensor2d(oversampled.map(s => [s.label]));
  const xVal = tf.tensor2d(valSamples.map(s => normalize(s.features, norm)));
  const yVal = tf.tensor2d(valSamples.map(s => [s.label]));

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

  // ═══ MODEL VERSIONING: Snapshot current model before overwriting ═══
  if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR, { recursive: true });

  let previousMetrics = null;
  const snapshotDir = snapshotCurrentModel();
  if (snapshotDir) {
    try {
      previousMetrics = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'metrics.json'), 'utf8'));
    } catch {}
  }

  // Save new model
  await model.save(`file://${MODEL_DIR}`);
  console.log(`\nModel saved to ${MODEL_DIR}`);

  // Save normalization params
  fs.writeFileSync(NORM_FILE, JSON.stringify(norm, null, 2));
  console.log(`Normalization params saved to ${NORM_FILE}`);

  // Compute alpha (blend weight) based on data volume and accuracy
  // Lower alpha = more weight on distance curve (more conservative, better calibrated)
  // Higher alpha = more weight on ML (can over-predict when model is over-confident)
  const waveCount = completedWaves.length;
  let alpha = 0;
  if (waveCount >= 10 && fullMetrics.accuracy >= 0.92) {
    alpha = 0.70;
  } else if (waveCount >= 10 && fullMetrics.accuracy >= 0.88) {
    alpha = 0.55;
  } else if (waveCount >= 10 && fullMetrics.accuracy >= 0.80) {
    alpha = 0.45;
  } else if (waveCount >= 3) {
    alpha = Math.min(0.2 + (fullMetrics.accuracy - 0.5) * 0.6, 0.4);
    alpha = Math.max(alpha, 0.15);
  } else {
    alpha = Math.min(waveCount / 5, 0.2) * fullMetrics.accuracy;
  }
  alpha = Math.max(0, Math.min(0.70, alpha));

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
  
  // Save city average delay data for server predictions
  const DELAY_FILE = path.join(MODEL_DIR, 'city-delays.json');
  fs.writeFileSync(DELAY_FILE, JSON.stringify(cityAvgDelay, null, 2));
  console.log(`City delay data saved to ${DELAY_FILE}`);

  const RATES_FILE = path.join(MODEL_DIR, 'city-historical-rates.json');
  fs.writeFileSync(RATES_FILE, JSON.stringify(cityHistoricalRates, null, 2));
  console.log(`City historical rates saved to ${RATES_FILE} (${Object.keys(cityHistoricalRates).length} cities)`);

  const COND_RATES_FILE = path.join(MODEL_DIR, 'city-conditional-rates.json');
  fs.writeFileSync(COND_RATES_FILE, JSON.stringify(cityConditionalRates, null, 2));
  console.log(`Conditional rates saved to ${COND_RATES_FILE} (${Object.keys(cityConditionalRates).length} cities)`);
  
  console.log(`\nBlend alpha: ${alpha.toFixed(2)} (${alpha >= 0.8 ? 'trusting ML mostly' : alpha >= 0.4 ? 'blending ML + distance curve' : 'mostly distance curve'})`);

  // ═══ MODEL VERSIONING: Compare with previous model and rollback if worse ═══
  if (previousMetrics && previousMetrics.validation) {
    const prevAcc = previousMetrics.validation.accuracy;
    const newAcc = metrics.accuracy;
    const prevF1 = previousMetrics.validation.f1;
    const newF1 = metrics.f1;
    const accDelta = newAcc - prevAcc;
    const f1Delta = newF1 - prevF1;

    console.log(`\n[Versioning] Previous: acc=${(prevAcc * 100).toFixed(1)}% f1=${(prevF1 * 100).toFixed(1)}%`);
    console.log(`[Versioning] New:      acc=${(newAcc * 100).toFixed(1)}% f1=${(newF1 * 100).toFixed(1)}%`);
    console.log(`[Versioning] Delta:    acc=${accDelta >= 0 ? '+' : ''}${(accDelta * 100).toFixed(2)}% f1=${f1Delta >= 0 ? '+' : ''}${(f1Delta * 100).toFixed(2)}%`);

    // Rollback if BOTH accuracy and F1 dropped significantly (>2% each)
    // This avoids rollback on minor fluctuations or tradeoffs (precision vs recall)
    if (accDelta < -0.02 && f1Delta < -0.02) {
      console.log(`[Versioning] ⚠️  Significant regression detected! Rolling back...`);
      rollbackModel(snapshotDir);
    } else if (accDelta < -0.05 || f1Delta < -0.05) {
      // Rollback if either metric dropped severely (>5%)
      console.log(`[Versioning] ⚠️  Severe drop in one metric! Rolling back...`);
      rollbackModel(snapshotDir);
    } else {
      console.log(`[Versioning] ✅ New model accepted`);
    }
  } else {
    console.log(`\n[Versioning] First model version — no comparison needed`);
  }

  // Prune old model history (keep last N snapshots)
  pruneModelHistory();

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
