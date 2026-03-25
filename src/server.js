const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Load .env file if present
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const config = require('../lib/config');
const { haversineKm } = require('../lib/utils/geo');
const { 
  clusterCitiesByRegion, 
  detectAttackPattern, 
  getRegionalProbabilityMultiplier,
  getRedAlertFeedbackMultiplier,
  getCityRegion 
} = require('../lib/utils/regions');
const { detectMultiMissile, getRelevantCenter } = require('../lib/utils/multi-missile');
const { isRed: isAlertRed, isOrange: isAlertOrange } = require('../lib/utils/alerts');
const { extractFeatures, normalizeFeatures, getFeatureCount } = require('../lib/ml/features');
const { validateModel } = require('../lib/ml/validate-model');
const { notifyOrangeWave } = require('../lib/utils/telegram');

let tf;
try { tf = require('@tensorflow/tfjs-node'); } catch { try { tf = require('@tensorflow/tfjs'); } catch { tf = null; } }

const PORT = config.PORT;
const ALERTS_URL = config.OREF_ALERTS_URL;
const HISTORY_URL = config.OREF_HISTORY_URL;
const FULL_HISTORY_URL = config.OREF_FULL_HISTORY_URL;
const HEADERS = config.OREF_HEADERS;
const HISTORY_HEADERS = config.OREF_HISTORY_HEADERS;

const citiesJson = fs.readFileSync(path.join(__dirname, '..', config.PATHS.CITIES), 'utf8');
const polygonsJson = fs.readFileSync(path.join(__dirname, '..', config.PATHS.POLYGONS), 'utf8');

const citiesData = JSON.parse(citiesJson);
const nameToCity = {};
citiesData.forEach(c => { nameToCity[c.name] = c; });

let cachedHistory = { data: [], fetchedAt: 0 };
const HISTORY_CACHE_MS = config.HISTORY_CACHE_MS;

// ── ML Model ──
const MODEL_DIR = path.join(__dirname, '../model');
const NORM_FILE = path.join(MODEL_DIR, 'normalization.json');
const METRICS_FILE = path.join(MODEL_DIR, 'metrics.json');
const DELAY_FILE = path.join(MODEL_DIR, 'city-delays.json');
const RATES_FILE = path.join(MODEL_DIR, 'city-historical-rates.json');
const COND_RATES_FILE = path.join(MODEL_DIR, 'city-conditional-rates.json');

let mlModel = null;
let mlNorm = null;
let mlMetrics = null;
let cityDelays = {};
let cityHistoricalRates = {};
let cityConditionalRates = {};

async function loadModel() {
  if (!tf) { console.log('[ML] TensorFlow.js not available'); return; }
  try {
    const modelPath = `file://${MODEL_DIR}/model.json`;
    if (!fs.existsSync(path.join(MODEL_DIR, 'model.json'))) {
      console.log('[ML] No trained model found');
      return;
    }
    
    // ═══ VALIDATION: Check model compatibility BEFORE loading ═══
    console.log('[ML] Validating model compatibility...');
    const validation = validateModel(MODEL_DIR);
    
    if (!validation.valid) {
      console.error('[ML] ❌ MODEL VALIDATION FAILED:');
      validation.errors.forEach(e => console.error(`     ${e}`));
      console.error('[ML] Server will start but predictions may fail!');
      console.error('[ML] Solution: Run "npm run train" to retrain the model');
      mlModel = null;
      return;
    }
    
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(w => console.log(`[ML] ⚠️  ${w}`));
    }
    console.log(`[ML] ✅ Validation passed (${getFeatureCount()} features)`);
    
    mlModel = await tf.loadLayersModel(modelPath);
    mlNorm = JSON.parse(fs.readFileSync(NORM_FILE, 'utf8'));
    mlMetrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
    
    // Load city average delays
    if (fs.existsSync(DELAY_FILE)) {
      cityDelays = JSON.parse(fs.readFileSync(DELAY_FILE, 'utf8'));
      console.log(`[ML] Loaded delay data for ${Object.keys(cityDelays).length} cities`);
    }
    if (fs.existsSync(RATES_FILE)) {
      cityHistoricalRates = JSON.parse(fs.readFileSync(RATES_FILE, 'utf8'));
      console.log(`[ML] Loaded historical rates for ${Object.keys(cityHistoricalRates).length} cities`);
    }
    if (fs.existsSync(COND_RATES_FILE)) {
      cityConditionalRates = JSON.parse(fs.readFileSync(COND_RATES_FILE, 'utf8'));
      console.log(`[ML] Loaded conditional rates for ${Object.keys(cityConditionalRates).length} cities`);
    }
    
    console.log(`[ML] Model loaded (alpha=${mlMetrics.alpha.toFixed(2)}, waves=${mlMetrics.wavesUsed}, val_acc=${(mlMetrics.validation.accuracy * 100).toFixed(1)}%)`);
  } catch (err) {
    console.log(`[ML] Failed to load model: ${err.message}`);
    mlModel = null;
  }
}

// Watch for model changes and reload
if (fs.existsSync(MODEL_DIR)) {
  fs.watch(MODEL_DIR, { persistent: false }, (eventType, filename) => {
    if (filename === 'model.json' || filename === 'metrics.json' || filename === 'city-delays.json' || filename === 'city-historical-rates.json' || filename === 'city-conditional-rates.json') {
      console.log('[ML] Model files changed, reloading...');
      setTimeout(() => loadModel(), 1000);
    }
  });
}

// Static distance curve fallback
const PROB_CURVE = config.PROB_CURVE;

function distToProb(distKm) {
  if (distKm <= PROB_CURVE[0].dist) return PROB_CURVE[0].prob;
  if (distKm >= PROB_CURVE[PROB_CURVE.length - 1].dist) return PROB_CURVE[PROB_CURVE.length - 1].prob;
  for (let i = 0; i < PROB_CURVE.length - 1; i++) {
    const a = PROB_CURVE[i], b = PROB_CURVE[i + 1];
    if (distKm >= a.dist && distKm <= b.dist) {
      const t = (distKm - a.dist) / (b.dist - a.dist);
      return a.prob + t * (b.prob - a.prob);
    }
  }
  return 0;
}

function predictWithML(cityNames, centerLat, centerLng, zoneSize, centerOverrides = {}, multiMissileInfo = null, orangeCities = []) {
  if (!mlModel || !mlNorm || !tf) return null;

  const hour = new Date().getHours();
  const features = [];
  const validCities = [];

  for (const name of cityNames) {
    const city = nameToCity[name];
    if (!city || !city.lat || !city.lng) continue;

    // Use city-specific center if provided (for multi-missile scenarios)
    const useCenterLat = centerOverrides[name] ? centerOverrides[name].lat : centerLat;
    const useCenterLng = centerOverrides[name] ? centerOverrides[name].lng : centerLng;

    try {
      // ═══ USE CENTRALIZED FEATURE EXTRACTION ═══
      const featureVector = extractFeatures({
        city,
        center: { lat: useCenterLat, lng: useCenterLng },
        hour,
        cityRates: cityHistoricalRates,
        cityDelays,
        warningDelayMinutes: 0,
        multiMissileInfo,
        orangeCities,
        nameToCity
      });
      
      features.push(featureVector);
      validCities.push(name);
    } catch (err) {
      console.error(`[ML] Feature extraction failed for ${name}:`, err.message);
      continue;
    }
  }

  if (features.length === 0) return null;

  try {
    // Normalize using centralized function
    const normalized = features.map(f => normalizeFeatures(f, mlNorm));

    const inputTensor = tf.tensor2d(normalized);
    const predictions = mlModel.predict(inputTensor);
    const probs = Array.from(predictions.dataSync());

    inputTensor.dispose();
    predictions.dispose();

    const result = {};
    for (let i = 0; i < validCities.length; i++) {
      result[validCities[i]] = Math.round(probs[i] * 100);
    }
    return result;
  } catch (err) {
    console.error('[ML] Prediction failed:', err.message);
    return null;
  }
}

function resolveAttackCenter(orangeCities, redCities, defaultLat, defaultLng) {
  const redCoords = redCities.map(n => nameToCity[n]).filter(c => c && c.lat && c.lng);
  const orangeCoords = orangeCities.map(n => nameToCity[n]).filter(c => c && c.lat && c.lng);

  const calc = arr => ({
    lat: arr.reduce((s, c) => s + c.lat, 0) / arr.length,
    lng: arr.reduce((s, c) => s + c.lng, 0) / arr.length
  });

  const redCenter = redCoords.length > 0 ? calc(redCoords) : null;
  const orangeCenter = orangeCoords.length > 0 ? calc(orangeCoords) : null;

  if (redCenter && orangeCenter) {
    const dist = haversineKm(redCenter.lat, redCenter.lng, orangeCenter.lat, orangeCenter.lng);
    if (dist >= 60) return { center: orangeCenter, useRed: false };

    // In wide multi-region attacks, reds fire first at one edge (closest to
    // source) and the red centroid is skewed. Use a weighted blend: the more
    // the reds are concentrated in one part of the polygon, the more we lean
    // toward the orange centroid which better represents the full threat zone.
    const redRatio = redCoords.length / (redCoords.length + orangeCoords.length);
    // High red ratio (>40%) = reds are widespread, trust red center more
    // Low red ratio (<20%) = reds are early/partial, trust orange center more
    const redWeight = Math.min(0.7, Math.max(0.2, redRatio * 1.5));
    const blended = {
      lat: redWeight * redCenter.lat + (1 - redWeight) * orangeCenter.lat,
      lng: redWeight * redCenter.lng + (1 - redWeight) * orangeCenter.lng
    };
    return { center: blended, useRed: true };
  }

  if (redCenter) return { center: redCenter, useRed: true };
  if (orangeCenter) return { center: orangeCenter, useRed: false };
  return { center: { lat: defaultLat, lng: defaultLng }, useRed: false };
}

function buildCitiesForClustering(orangeCities, redForClustering) {
  if (orangeCities.length >= 20) {
    const coords = orangeCities.map(n => nameToCity[n]).filter(c => c && c.lat);
    if (coords.length > 0) {
      const cLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
      const cLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
      const nearbyReds = redForClustering.filter(n => {
        const c = nameToCity[n];
        return c && c.lat && haversineKm(c.lat, c.lng, cLat, cLng) < 80;
      });
      return [...new Set([...orangeCities, ...nearbyReds])];
    }
    return [...orangeCities];
  }
  if (redForClustering.length >= 20) return [...redForClustering];
  return [...new Set([...orangeCities, ...redForClustering])];
}

function computeRedFeedback(multiMissileInfo, redCities, orangeCities, useRedCenter, timeElapsedMinutes) {
  let global = 1.0;
  let perCluster = null;

  if (redCities.length === 0) return { global, perCluster };

  if (multiMissileInfo && multiMissileInfo.detected) {
    const redSet = new Set(redCities);
    perCluster = {};
    multiMissileInfo.clusters.forEach(cluster => {
      const orangeCount = cluster.cities.filter(c => !redSet.has(c)).length;
      const redCount = cluster.cities.filter(c => redSet.has(c)).length;
      const feedback = redCount > 0
        ? getRedAlertFeedbackMultiplier(orangeCount + redCount, redCount, timeElapsedMinutes)
        : 1.0;
      cluster.cities.forEach(c => { perCluster[c] = feedback; });
    });
  } else if (useRedCenter) {
    global = getRedAlertFeedbackMultiplier(orangeCities.length, redCities.length, timeElapsedMinutes);
  }
  return { global, perCluster };
}

async function predict(cityNames, centerLat, centerLng, zoneSize, options = {}) {
  const { 
    orangeCities = cityNames, 
    redCities = [],
    redCitiesForClustering = null,
    timeElapsedMinutes = 0 
  } = options;

  const { center: actualCenter, useRed: useRedCenter } = resolveAttackCenter(orangeCities, redCities, centerLat, centerLng);

  // Multi-missile detection
  const redForClustering = redCitiesForClustering !== null ? redCitiesForClustering : redCities;
  const citiesForClustering = buildCitiesForClustering(orangeCities, redForClustering);
  
  let citiesWithTiming = null;
  if (citiesForClustering.length >= 30) {
    try {
      const history = await fetchFullHistory();
      const cutoffMs = Date.now() - 30 * 60000;
      const cityToTime = {};
      history.forEach(h => {
        if (!h || !h.title) return;
        if (!h.title.includes('ירי רקטות') && !h.title.includes('בדקות הקרובות')) return;
        if (new Date((h.alertDate || '').replace(' ', 'T')).getTime() < cutoffMs) return;
        if (!cityToTime[h.data] || h.alertDate < cityToTime[h.data]) {
          cityToTime[h.data] = h.alertDate;
        }
      });
      citiesWithTiming = citiesForClustering
        .filter(c => cityToTime[c])
        .map(c => ({ name: c, time: cityToTime[c] }));
      if (citiesWithTiming.length < 20) citiesWithTiming = null;
    } catch (e) {
      console.error('[Multi-missile] Timing fetch failed:', e.message);
    }
  }
  
  const multiMissileInfo = detectMultiMissile(citiesWithTiming || citiesForClustering, nameToCity);

  // Use RED cities to determine the primary attack region — but only when there
  // are enough reds to be statistically meaningful. With very few reds (< 10),
  // they may be stray hits from a different area (e.g. 2 northern border reds
  // during a massive central-Israel wave) and would misclassify the entire attack.
  // Require a substantial number of reds AND that they represent at least 5%
  // of the zone before trusting them for regional classification. A handful of
  // reds from a different area (e.g. northern border) would misclassify the
  // entire attack and halve all predictions via the regional multiplier.
  const MIN_REDS_FOR_REGION = 30;
  const redRatio = orangeCities.length > 0 ? redCities.length / orangeCities.length : 0;
  const useRedsForRegion = redCities.length >= MIN_REDS_FOR_REGION && redRatio >= 0.05;
  const redClusterCities = useRedsForRegion ? redCities : orangeCities;
  const clusters = clusterCitiesByRegion(redClusterCities, nameToCity);
  const attackPattern = detectAttackPattern(clusters, actualCenter.lat, actualCenter.lng);
  const { global: globalRedFeedback, perCluster: perClusterRedFeedback } = computeRedFeedback(
    multiMissileInfo, redCities, orangeCities, useRedCenter, timeElapsedMinutes
  );

  // Gentle zone-size normalization: in very large zones, distances are slightly
  // compressed so the distance curve remains meaningful. Capped at 0.75 minimum
  // to preserve real geographic separation (Tel Aviv at 54km should NOT look like 27km).
  const REF_ZONE_RADIUS = 30;
  const orangeCoordsList = orangeCities.map(n => nameToCity[n]).filter(c => c && c.lat && c.lng);
  let zoneDistScale = 1;
  if (orangeCoordsList.length > 50) {
    const orangeDists = orangeCoordsList
      .map(c => haversineKm(c.lat, c.lng, actualCenter.lat, actualCenter.lng))
      .sort((a, b) => a - b);
    const medianRadius = orangeDists[Math.floor(orangeDists.length * 0.5)];
    if (medianRadius > REF_ZONE_RADIUS) {
      zoneDistScale = Math.max(0.75, REF_ZONE_RADIUS / medianRadius);
    }
  }

  // Build per-city center overrides, distances, and distance predictions
  const centerOverrides = {};
  const distPreds = {};
  const cityDistKm = {};
  for (const name of cityNames) {
    const city = nameToCity[name];
    if (!city || !city.lat || !city.lng) { distPreds[name] = 50; cityDistKm[name] = 50; continue; }
    
    let centerToUse = actualCenter;
    if (multiMissileInfo && multiMissileInfo.detected) {
      const relevantCenter = getRelevantCenter(name, multiMissileInfo, nameToCity);
      if (relevantCenter) {
        centerToUse = { lat: relevantCenter.lat, lng: relevantCenter.lng };
        centerOverrides[name] = centerToUse;
      }
    }
    
    const dKm = haversineKm(city.lat, city.lng, centerToUse.lat, centerToUse.lng);
    cityDistKm[name] = dKm;
    const effectiveDist = dKm * zoneDistScale;
    distPreds[name] = Math.round(distToProb(effectiveDist));
  }

  // Get ML predictions if model is available (with per-city centers for multi-missile)
  const mlPreds = predictWithML(cityNames, actualCenter.lat, actualCenter.lng, zoneSize, centerOverrides, multiMissileInfo, orangeCities);
  const baseAlpha = mlMetrics ? mlMetrics.alpha : 0;
  // Dynamic alpha: in large zones the ML model is more reliable than the naive
  // distance curve because it accounts for zone size. Scale alpha up gradually.
  let alpha = baseAlpha;
  if (orangeCities.length > 100 && baseAlpha > 0) {
    const zoneBonus = Math.min(0.20, (orangeCities.length - 100) / 600 * 0.20);
    alpha = Math.min(0.70, baseAlpha + zoneBonus);
  }
  const useML = mlPreds !== null && alpha > 0;

  const results = {};
  for (const name of cityNames) {
    const distProb = distPreds[name] || 0;
    const avgDelayMin = cityDelays[name] || null;
    
    // Get base probability
    let baseProb;
    let mlProb = null;
    let source = 'distance_curve';
    
    if (useML && mlPreds[name] !== undefined) {
      mlProb = mlPreds[name];
      baseProb = alpha * mlProb + (1 - alpha) * distProb;
      source = 'blended';
    } else {
      baseProb = distProb;
    }

    // Apply regional multiplier (with multi-missile awareness)
    const cityRegion = getCityRegion(name, nameToCity);
    const regionalMultiplier = getRegionalProbabilityMultiplier(cityRegion, attackPattern, multiMissileInfo, name);
    
    // Apply red feedback multiplier (per-cluster in multi-missile, global otherwise)
    const redFeedbackMult = perClusterRedFeedback
      ? (perClusterRedFeedback[name] != null ? perClusterRedFeedback[name] : 1.0)
      : globalRedFeedback;
    
    // Combine multipliers into model probability
    const modelProb = baseProb * regionalMultiplier * redFeedbackMult;
    
    // Historical calibration: use attack-size-conditional rate when available.
    const condRate = cityConditionalRates[name];
    const isLargeAttack = orangeCities.length >= 100;
    let histRate;
    if (condRate) {
      const sizeRate = isLargeAttack ? condRate.large : condRate.small;
      histRate = sizeRate != null ? sizeRate : condRate.overall;

      // Focused-attack adjustment: "large" rate lumps focused regional attacks
      // (e.g., 364-city TLV wave, 90% conversion) with diffuse multi-region attacks
      // (684-city wide wave, 58% conversion). When the attack is concentrated on
      // THIS city's region, blend the small-attack rate in — it better represents
      // focused attacks targeting this region specifically.
      if (isLargeAttack && condRate.small != null && condRate.large != null) {
        const isFocused = cityRegion === attackPattern.primaryRegion &&
                          attackPattern.concentration >= 35;
        if (isFocused) {
          const focusBlend = Math.min(0.5, (attackPattern.concentration - 35) / 30 * 0.5);
          histRate = focusBlend * condRate.small + (1 - focusBlend) * condRate.large;
        }
      }
    } else {
      histRate = cityHistoricalRates[name];
    }

    let finalProb;
    if (histRate != null) {
      const adjustedHistPct = histRate * 100;

      // Asymmetric calibration: history serves as a reality check.
      // - If model predicts HIGH but history says LOW: pull down toward history
      //   (model is overconfident for this city, e.g. Tel Aviv in a small Jerusalem attack)
      // - If model predicts LOW but history says HIGH: pull up moderately
      //   (this city usually gets hit, model might be underweighting it)
      // - If they agree: trust their consensus
      const gap = adjustedHistPct - modelProb;
      let histWeight;

      if (gap < -15) {
        // Model > History by 15+: model is overconfident, trust history more
        histWeight = Math.min(0.70, 0.45 + Math.min(0.25, Math.abs(gap) / 50 * 0.25));
      } else if (gap > 15) {
        // History > Model by 15+: model might be right for this specific attack
        histWeight = Math.min(0.50, 0.30 + Math.min(0.20, gap / 60 * 0.20));
      } else {
        // Agreement zone: light blend, trust model
        histWeight = 0.30;
      }
      finalProb = Math.max(1, Math.min(99, Math.round(
        histWeight * adjustedHistPct + (1 - histWeight) * modelProb
      )));
    } else {
      finalProb = Math.max(1, Math.min(99, Math.round(modelProb)));
    }

    results[name] = {
      prob: finalProb,
      ml: mlProb,
      dist: distProb,
      source,
      estimatedArrivalMinutes: avgDelayMin,
      region: cityRegion,
      regionalMultiplier: Math.round(regionalMultiplier * 100) / 100,
      redFeedbackMultiplier: Math.round(redFeedbackMult * 100) / 100,
      historicalRate: histRate != null ? Math.round(histRate * 100) : null,
      distKm: Math.round((cityDistKm[name] || 0) * 10) / 10
    };
  }

  return {
    predictions: results,
    attackPattern: {
      primaryRegion: attackPattern.primaryRegion,
      isFocused: attackPattern.isFocused,
      concentration: Math.round(attackPattern.concentration),
      regionCounts: attackPattern.regionCounts
    },
    redAlertStatus: {
      redCount: redCities.length,
      orangeCount: orangeCities.length,
      feedbackActive: redCities.length > 0
    },
    multiMissile: multiMissileInfo && multiMissileInfo.detected ? {
      detected: true,
      clusterCount: multiMissileInfo.clusters.length,
      separation: Math.round(multiMissileInfo.separation),
      balance: Math.round(multiMissileInfo.balance * 100),
      clusters: multiMissileInfo.clusters.map(c => ({
        size: c.size,
        center: c.center,
        seedName: c.seedName,
        cities: c.cities
      }))
    } : { detected: false },
    centerUsed: {
      lat: actualCenter.lat,
      lng: actualCenter.lng,
      source: useRedCenter ? 'red_alerts' : 'orange_alerts'
    },
    model: useML ? {
      alpha,
      accuracy: mlMetrics.validation.accuracy,
      wavesUsed: mlMetrics.wavesUsed,
      trainedAt: mlMetrics.trainedAt
    } : null
  };
}

// ── API handlers ──
async function fetchAlerts() {
  try {
    const res = await axios.get(ALERTS_URL, {
      headers: HEADERS,
      responseType: 'arraybuffer',
      timeout: 5000
    });
    let text = Buffer.from(res.data).toString('utf8').replace(/^\uFEFF/, '');
    if (!text || text.trim() === '') return { active: false, alerts: null };
    return { active: true, alerts: JSON.parse(text) };
  } catch (err) {
    return { active: false, alerts: null, error: err.message };
  }
}

async function fetchFullHistory() {
  const now = Date.now();
  if (cachedHistory.data.length > 0 && (now - cachedHistory.fetchedAt) < HISTORY_CACHE_MS) {
    return cachedHistory.data;
  }
  try {
    const res = await axios.get(HISTORY_URL, {
      headers: HEADERS,
      responseType: 'arraybuffer',
      timeout: 10000
    });
    let text = Buffer.from(res.data).toString('utf8').replace(/^\uFEFF/, '');
    if (!text || text.trim() === '' || text.trim() === '[]') return [];
    const history = JSON.parse(text);
    cachedHistory = { data: history, fetchedAt: now };
    return history;
  } catch (err) {
    return cachedHistory.data;
  }
}

function sendJson(res, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/alerts') {
    sendJson(res, await fetchAlerts());
    return;
  }

  if (url.pathname === '/api/history') {
    sendJson(res, await fetchFullHistory());
    return;
  }

  if (url.pathname === '/api/recent-history') {
    try {
      const testWave = url.searchParams.get('testWave') === '1';
      let merged;
      if (testWave) {
        const cities = JSON.parse(citiesJson).filter(c => c.id !== 0).slice(0, 25);
        const twoMinAgo = new Date(Date.now() - 2 * 60000);
        const ts = twoMinAgo.toISOString().slice(0, 19).replace('T', ' ');
        merged = cities.map(c => ({
          alertDate: ts, data: c.name,
          title: 'בדקות הקרובות צפויות להתקבל התרעות באזורך',
          category_desc: 'בדקות הקרובות צפויות להתקבל התרעות באזורך',
          category: 14
        }));
      } else {
      const history = await fetchFullHistory();
      const collectedFile = path.join(__dirname, '../data/collected-alerts.json');
      merged = Array.isArray(history) ? [...history] : [];
      if (fs.existsSync(collectedFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(collectedFile, 'utf8'));
          const all = Object.values(raw || {});
          const cutoffMs = Date.now() - 30 * 60000;
          const recent = all.filter(a => a && new Date((a.alertDate || '').replace(' ', 'T')).getTime() >= cutoffMs);
          const seen = new Set(merged.map(h => `${h.alertDate}|${h.data}|${h.title || h.category_desc || ''}`));
          for (const a of recent) {
            const key = `${a.alertDate}|${a.data}|${a.title || a.category_desc || ''}`;
            if (!seen.has(key)) {
              seen.add(key);
              merged.push({ alertDate: a.alertDate, data: a.data, title: a.title || a.category_desc, category_desc: a.title || a.category_desc });
            }
          }
          merged.sort((a, b) => new Date((b.alertDate || '').replace(' ', 'T')) - new Date((a.alertDate || '').replace(' ', 'T')));
        } catch (e) {
          console.error('[recent-history] collected parse error:', e.message);
        }
      }
      }
      sendJson(res, merged);
    } catch (err) {
      console.error('[recent-history] error:', err.message);
      sendJson(res, []);
    }
    return;
  }

  if (url.pathname === '/api/cities') {
    res.setHeader('Content-Type', 'application/json');
    res.end(citiesJson);
    return;
  }

  if (url.pathname === '/api/polygons') {
    res.setHeader('Content-Type', 'application/json');
    res.end(polygonsJson);
    return;
  }

  if (url.pathname === '/api/full-history') {
    const mode = url.searchParams.get('mode') || '3';
    const city = url.searchParams.get('city');
    let fetchUrl = FULL_HISTORY_URL + '&mode=' + mode;
    if (city) fetchUrl += '&city_0=' + encodeURIComponent(city);
    try {
      const r = await axios.get(fetchUrl, { headers: HISTORY_HEADERS, timeout: 15000 });
      sendJson(res, r.data);
    } catch (err) {
      sendJson(res, { error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/collected') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    const collectedFile = path.join(__dirname, '../data/collected-alerts.json');
    if (fs.existsSync(collectedFile)) {
      const raw = JSON.parse(fs.readFileSync(collectedFile, 'utf8'));
      const all = Object.values(raw);
      const city = url.searchParams.get('city');
      const days = parseInt(url.searchParams.get('days')) || 30;
      const cutoffMs = Date.now() - days * 86400000;
      let filtered = all.filter(a => {
        const alertTime = new Date(a.alertDate.replace(' ', 'T')).getTime();
        return alertTime >= cutoffMs;
      });
      if (city) filtered = filtered.filter(a => a.data === city);
      filtered.sort((a, b) => b.alertDate.localeCompare(a.alertDate));
      sendJson(res, filtered);
    } else {
      sendJson(res, []);
    }
    return;
  }

  if (url.pathname === '/api/leaderboard') {
    const type = url.searchParams.get('type') || 'red';
    const days = parseInt(url.searchParams.get('days')) || 7;
    const collectedFile = path.join(__dirname, '../data/collected-alerts.json');
    
    if (!fs.existsSync(collectedFile)) {
      sendJson(res, { leaderboard: [] });
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(collectedFile, 'utf8'));
      const all = Object.values(raw);
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
      
      const isRed = isAlertRed;
      const isOrange = isAlertOrange;

      const filtered = all.filter(a => {
        if (a.alertDate < cutoff) return false;
        const desc = a.category_desc || a.title || '';
        if (type === 'red') return isRed(desc);
        if (type === 'orange') return isOrange(desc);
        return false;
      });

      const counts = {};
      filtered.forEach(alert => {
        const cityName = alert.data;
        if (!cityName) return;
        counts[cityName] = (counts[cityName] || 0) + 1;
      });

      const leaderboard = Object.entries(counts)
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);

      sendJson(res, { leaderboard, type, days });
    } catch (err) {
      console.error('Leaderboard error:', err);
      sendJson(res, { leaderboard: [], error: err.message });
    }
    return;
  }

  if (url.pathname === '/api/predict') {
    // Support both GET and POST (POST for large city lists to avoid URL length limits)
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const centerLat = parseFloat(data.centerLat);
          const centerLng = parseFloat(data.centerLng);
          const zoneSize = parseInt(data.zoneSize) || 0;
          const cityNames = data.cities || [];
          
          // NEW: Accept orangeCities, redCities, timeElapsed for improved predictions
          const orangeCities = data.orangeCities || cityNames;
          const redCities = data.redCities || [];
          const redCitiesForClustering = data.redCitiesForClustering || null; // For multi-missile detection
          const timeElapsedMinutes = parseFloat(data.timeElapsedMinutes) || 0;
          
          if (!cityNames.length || isNaN(centerLat) || isNaN(centerLng)) {
            sendJson(res, { error: 'Missing params: cities, centerLat, centerLng' });
            return;
          }
          
          const result = await predict(cityNames, centerLat, centerLng, zoneSize, {
            orangeCities,
            redCities,
            redCitiesForClustering,
            timeElapsedMinutes
          });
          sendJson(res, result);
          
          // Save favorites for startup notifications & trigger Telegram.
          // Only overwrite if the new list is at least as large as the stored
          // one, so a stale browser tab with fewer favorites can't clobber the file.
          if (data.favorites && data.favorites.length > 0) {
            try {
              const favFile = path.join(__dirname, '..', 'data', 'favorites.json');
              let existing = [];
              if (fs.existsSync(favFile)) {
                try { existing = JSON.parse(fs.readFileSync(favFile, 'utf8')); } catch (_) {}
              }
              if (data.favorites.length >= existing.length) {
                fs.writeFileSync(favFile, JSON.stringify(data.favorites));
              }
            } catch (e) {}
          }
          if (orangeCities.length >= 5 && data.favorites) {
            notifyOrangeWave(orangeCities, redCities, data.favorites, result.predictions, result.multiMissile, result.attackPattern).catch(() => {});
          }
        } catch (err) {
          console.error('[API/predict] Error:', err.stack || err.message);
          sendJson(res, { error: err.message });
        }
      });
      return;
    }
    
    // GET method (for backwards compatibility)
    const citiesParam = url.searchParams.get('cities');
    const centerLat = parseFloat(url.searchParams.get('centerLat'));
    const centerLng = parseFloat(url.searchParams.get('centerLng'));
    const zoneSize = parseInt(url.searchParams.get('zoneSize')) || 0;

    if (!citiesParam || isNaN(centerLat) || isNaN(centerLng)) {
      sendJson(res, { error: 'Missing params: cities, centerLat, centerLng' });
      return;
    }

    const cityNames = citiesParam.split(',').map(c => decodeURIComponent(c.trim()));
    
    // NEW: Support optional orange/red parameters in GET
    const orangeParam = url.searchParams.get('orangeCities');
    const redParam = url.searchParams.get('redCities');
    const timeElapsed = parseFloat(url.searchParams.get('timeElapsedMinutes')) || 0;
    
    const result = await predict(cityNames, centerLat, centerLng, zoneSize, {
      orangeCities: orangeParam ? orangeParam.split(',').map(c => decodeURIComponent(c.trim())) : cityNames,
      redCities: redParam ? redParam.split(',').map(c => decodeURIComponent(c.trim())) : [],
      timeElapsedMinutes: timeElapsed
    });
    sendJson(res, result);
    return;
  }

  if (url.pathname === '/api/model-info') {
    sendJson(res, {
      hasModel: mlModel !== null,
      metrics: mlMetrics,
      alpha: mlMetrics ? mlMetrics.alpha : 0
    });
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.end(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));
    return;
  }

  // Serve static files from public directory
  if (url.pathname.startsWith('/public/')) {
    const filePath = path.join(__dirname, '..', url.pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      // Prevent caching of JS/CSS files during development
      if (ext === '.js' || ext === '.css' || ext === '.html') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
      res.end(fs.readFileSync(filePath));
      return;
    }
  }

  res.statusCode = 404;
  res.end('Not found');
});

// ── Startup alert check ──
async function checkActiveWaveOnStartup() {
  try {
    const history = await fetchFullHistory();
    if (!Array.isArray(history) || history.length === 0) return;

    const now = Date.now();
    const cutoff = now - 30 * 60000;
    const recent = {};
    for (const h of history) {
      if (!h || !h.data || !h.alertDate) continue;
      const t = new Date(h.alertDate.replace(' ', 'T')).getTime();
      if (t < cutoff) continue;
      if (!recent[h.data] || h.alertDate > recent[h.data].alertDate) {
        recent[h.data] = h;
      }
    }

    const orangeCities = [], redCities = [];
    const greenByCity = {};
    for (const [city, a] of Object.entries(recent)) {
      const title = a.title || '';
      if (title.includes('הסתיים') || title.includes('ניתן לצאת')) {
        greenByCity[city] = new Date(a.alertDate.replace(' ', 'T')).getTime();
      }
    }
    for (const [city, a] of Object.entries(recent)) {
      const title = a.title || '';
      const t = new Date(a.alertDate.replace(' ', 'T')).getTime();
      if (title.includes('בדקות הקרובות')) {
        if (greenByCity[city] && greenByCity[city] > t) continue;
        orangeCities.push(city);
      } else if (title.includes('ירי רקטות') && !title.includes('הסתיים')) {
        redCities.push(city);
      }
    }

    if (orangeCities.length < 5) {
      console.log(`[Startup] No active wave (${orangeCities.length} orange)`);
      return;
    }

    console.log(`[Startup] Active wave detected: ${orangeCities.length} orange, ${redCities.length} red`);

    const orangeCoords = orangeCities.map(n => nameToCity[n]).filter(c => c && c.lat);
    const redCoords = redCities.map(n => nameToCity[n]).filter(c => c && c.lat);
    const coords = redCoords.length > 0 ? redCoords : orangeCoords;
    if (coords.length === 0) return;

    const cLat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
    const cLng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;

    const result = await predict(orangeCities, cLat, cLng, orangeCities.length, {
      orangeCities, redCities, redCitiesForClustering: redCities, timeElapsedMinutes: 5
    });

    let favorites = [];
    try {
      const favFile = path.join(__dirname, '..', 'data', 'favorites.json');
      if (fs.existsSync(favFile)) favorites = JSON.parse(fs.readFileSync(favFile, 'utf8'));
    } catch (e) {}

    await notifyOrangeWave(orangeCities, redCities, favorites, result.predictions, result.multiMissile, result.attackPattern);
  } catch (err) {
    console.error('[Startup] Wave check failed:', err.message);
  }
}

// ── Sleep/wake detection ──
let lastHeartbeat = Date.now();
setInterval(() => {
  const now = Date.now();
  const gap = now - lastHeartbeat;
  lastHeartbeat = now;
  // If more than 30s passed since last 10s tick, the machine was sleeping
  if (gap > 30000) {
    console.log(`[Wake] Computer woke from sleep (${Math.round(gap / 1000)}s gap), checking for active wave...`);
    // Small delay to let network reconnect after wake
    setTimeout(checkActiveWaveOnStartup, 5000);
  }
}, 10000);

// ── Start ──
(async () => {
  await loadModel();
  server.listen(PORT, () => {
    console.log(`Live alert map running at http://localhost:${PORT}`);
  });
  setTimeout(checkActiveWaveOnStartup, 3000);
})();
