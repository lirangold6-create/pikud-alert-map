const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

let tf;
try { tf = require('@tensorflow/tfjs-node'); } catch { tf = null; }

const PORT = process.env.PORT || 3000;

const ALERTS_URL = 'https://www.oref.org.il/warningMessages/alert/Alerts.json';
const HISTORY_URL = 'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json';
const FULL_HISTORY_URL = 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx?lang=he';

const HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

const HISTORY_HEADERS = {
  'Referer': 'https://alerts-history.oref.org.il/12481-he/Pakar.aspx',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

const citiesJson = fs.readFileSync(path.join(__dirname, 'pikud-haoref-api/cities.json'), 'utf8');
const polygonsJson = fs.readFileSync(path.join(__dirname, 'pikud-haoref-api/polygons.json'), 'utf8');

const citiesData = JSON.parse(citiesJson);
const nameToCity = {};
citiesData.forEach(c => { nameToCity[c.name] = c; });

let cachedHistory = { data: [], fetchedAt: 0 };
const HISTORY_CACHE_MS = 30000;

// ── ML Model ──
const MODEL_DIR = path.join(__dirname, 'model');
const NORM_FILE = path.join(MODEL_DIR, 'normalization.json');
const METRICS_FILE = path.join(MODEL_DIR, 'metrics.json');

let mlModel = null;
let mlNorm = null;
let mlMetrics = null;

async function loadModel() {
  if (!tf) { console.log('[ML] TensorFlow.js not available'); return; }
  try {
    const modelPath = `file://${MODEL_DIR}/model.json`;
    if (!fs.existsSync(path.join(MODEL_DIR, 'model.json'))) {
      console.log('[ML] No trained model found');
      return;
    }
    mlModel = await tf.loadLayersModel(modelPath);
    mlNorm = JSON.parse(fs.readFileSync(NORM_FILE, 'utf8'));
    mlMetrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
    console.log(`[ML] Model loaded (alpha=${mlMetrics.alpha.toFixed(2)}, waves=${mlMetrics.wavesUsed}, val_acc=${(mlMetrics.validation.accuracy * 100).toFixed(1)}%)`);
  } catch (err) {
    console.log(`[ML] Failed to load model: ${err.message}`);
    mlModel = null;
  }
}

// Watch for model changes and reload
if (fs.existsSync(MODEL_DIR)) {
  fs.watch(MODEL_DIR, { persistent: false }, (eventType, filename) => {
    if (filename === 'model.json' || filename === 'metrics.json') {
      console.log('[ML] Model files changed, reloading...');
      setTimeout(() => loadModel(), 1000);
    }
  });
}

// ── ML Prediction helpers ──
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingRad(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return Math.atan2(y, x);
}

// Static distance curve fallback
const PROB_CURVE = [
  { dist: 0, prob: 100 }, { dist: 5, prob: 100 }, { dist: 10, prob: 100 },
  { dist: 15, prob: 100 }, { dist: 17, prob: 90 }, { dist: 20, prob: 70 },
  { dist: 25, prob: 39 }, { dist: 30, prob: 20 }, { dist: 40, prob: 10 },
  { dist: 50, prob: 4 }, { dist: 60, prob: 1 }, { dist: 80, prob: 0 },
];

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

function predictWithML(cityNames, centerLat, centerLng, zoneSize) {
  if (!mlModel || !mlNorm || !tf) return null;

  const hour = new Date().getHours();
  const hourRad = (hour / 24) * 2 * Math.PI;

  const features = [];
  const validCities = [];

  for (const name of cityNames) {
    const city = nameToCity[name];
    if (!city || !city.lat || !city.lng) continue;

    const dist = haversineKm(city.lat, city.lng, centerLat, centerLng);
    const bear = bearingRad(centerLat, centerLng, city.lat, city.lng);
    const countdown = city.countdown || 0;

    features.push([
      dist,
      Math.sin(bear),
      Math.cos(bear),
      zoneSize,
      city.lat,
      city.lng,
      centerLat,
      centerLng,
      countdown,
      Math.sin(hourRad),
      Math.cos(hourRad),
      0 // historical rate — not available at inference time for new cities, default 0
    ]);
    validCities.push(name);
  }

  if (features.length === 0) return null;

  // Normalize
  const normalized = features.map(f =>
    f.map((v, i) => (v - mlNorm.means[i]) / mlNorm.stds[i])
  );

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
}

function predict(cityNames, centerLat, centerLng, zoneSize) {
  // Get distance-based predictions
  const distPreds = {};
  for (const name of cityNames) {
    const city = nameToCity[name];
    if (!city || !city.lat || !city.lng) { distPreds[name] = 50; continue; }
    const dist = haversineKm(city.lat, city.lng, centerLat, centerLng);
    distPreds[name] = Math.round(distToProb(dist));
  }

  // Get ML predictions if model is available
  const mlPreds = predictWithML(cityNames, centerLat, centerLng, zoneSize);
  const alpha = mlMetrics ? mlMetrics.alpha : 0;
  const useML = mlPreds !== null && alpha > 0;

  const results = {};
  for (const name of cityNames) {
    const distProb = distPreds[name] || 0;
    if (useML && mlPreds[name] !== undefined) {
      const mlProb = mlPreds[name];
      const blended = Math.round(alpha * mlProb + (1 - alpha) * distProb);
      results[name] = { prob: blended, ml: mlProb, dist: distProb, source: 'blended' };
    } else {
      results[name] = { prob: distProb, ml: null, dist: distProb, source: 'distance_curve' };
    }
  }

  return {
    predictions: results,
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
    const collectedFile = path.join(__dirname, 'collected-alerts.json');
    if (fs.existsSync(collectedFile)) {
      const raw = JSON.parse(fs.readFileSync(collectedFile, 'utf8'));
      const all = Object.values(raw);
      const city = url.searchParams.get('city');
      const days = parseInt(url.searchParams.get('days')) || 30;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
      let filtered = all.filter(a => a.alertDate >= cutoff);
      if (city) filtered = filtered.filter(a => a.data === city);
      filtered.sort((a, b) => b.alertDate.localeCompare(a.alertDate));
      sendJson(res, filtered);
    } else {
      sendJson(res, []);
    }
    return;
  }

  if (url.pathname === '/api/predict') {
    const citiesParam = url.searchParams.get('cities');
    const centerLat = parseFloat(url.searchParams.get('centerLat'));
    const centerLng = parseFloat(url.searchParams.get('centerLng'));
    const zoneSize = parseInt(url.searchParams.get('zoneSize')) || 0;

    if (!citiesParam || isNaN(centerLat) || isNaN(centerLng)) {
      sendJson(res, { error: 'Missing params: cities, centerLat, centerLng' });
      return;
    }

    const cityNames = citiesParam.split(',').map(c => decodeURIComponent(c.trim()));
    const result = predict(cityNames, centerLat, centerLng, zoneSize);
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
    res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

// ── Start ──
(async () => {
  await loadModel();
  server.listen(PORT, () => {
    console.log(`Live alert map running at http://localhost:${PORT}`);
  });
})();
