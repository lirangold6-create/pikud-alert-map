const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const axios = require('axios');

const config = require('../lib/config');
const { buildWaves, isWaveComplete } = require('../lib/utils/waves');
const { alertKey } = require('../lib/utils/alerts');

const OREF_HISTORY_URL = config.OREF_HISTORY_URL;
const FULL_HISTORY_URL = config.OREF_FULL_HISTORY_URL + '&mode=1';
const TZEVAADOM_URL = config.TZEVAADOM_URL;
const OREF_HEADERS = config.OREF_HEADERS;
const FULL_HISTORY_HEADERS = config.OREF_HISTORY_HEADERS;

const RAW_FILE = path.join(__dirname, '..', config.PATHS.COLLECTED_ALERTS);
const WAVES_FILE = path.join(__dirname, '..', config.PATHS.COLLECTED_WAVES);
const TZEVAADOM_FILE = path.join(__dirname, '..', config.PATHS.COLLECTED_TZEVAADOM);

const POLL_INTERVAL = config.POLL_INTERVAL;
const MIN_WAVE_CITIES = config.MIN_WAVE_CITIES;

// ── State ──
let rawAlerts = {};
if (fs.existsSync(RAW_FILE)) {
  try { rawAlerts = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8')); } catch {}
}

let waves = [];
if (fs.existsSync(WAVES_FILE)) {
  try { waves = JSON.parse(fs.readFileSync(WAVES_FILE, 'utf8')); } catch {}
}

let tzevaadomEvents = [];
if (fs.existsSync(TZEVAADOM_FILE)) {
  try { tzevaadomEvents = JSON.parse(fs.readFileSync(TZEVAADOM_FILE, 'utf8')); } catch {}
}

let lastWaveAlertCount = 0;
let isRetraining = false;

// ── Polling ──
async function pollOref() {
  let totalNew = 0;

  // Poll the short-window AlertsHistory.json
  try {
    const res = await axios.get(OREF_HISTORY_URL, {
      headers: OREF_HEADERS,
      responseType: 'arraybuffer',
      timeout: 10000
    });
    let text = Buffer.from(res.data).toString('utf8').replace(/^\uFEFF/, '');
    if (text && text.trim() !== '' && text.trim() !== '[]') {
      const alerts = JSON.parse(text);
      for (const a of alerts) {
        const key = alertKey(a);
        if (!rawAlerts[key]) { rawAlerts[key] = a; totalNew++; }
      }
    }
  } catch (err) {
    console.error(`  [oref-short] Error: ${err.message}`);
  }

  // Poll the full GetAlarmsHistory.aspx (has orange/red/green with richer data)
  try {
    const res = await axios.get(FULL_HISTORY_URL, {
      headers: FULL_HISTORY_HEADERS,
      timeout: 15000
    });
    const alerts = res.data;
    if (Array.isArray(alerts)) {
      for (const a of alerts) {
        const converted = {
          alertDate: a.date.split('.').reverse().join('-') + ' ' + a.time,
          title: a.category_desc,
          data: a.data,
          category: a.category
        };
        const key = alertKey(converted);
        if (!rawAlerts[key]) { rawAlerts[key] = converted; totalNew++; }
      }
    }
  } catch (err) {
    console.error(`  [oref-full] Error: ${err.message}`);
  }

  if (totalNew > 0) {
    fs.writeFileSync(RAW_FILE, JSON.stringify(rawAlerts, null, 0));
  }
  return totalNew;
}

async function pollTzevaadom() {
  try {
    const res = await axios.get(TZEVAADOM_URL, { timeout: 10000 });
    const events = res.data;
    const seenIds = new Set(tzevaadomEvents.map(e => e.id));
    let newCount = 0;

    for (const event of events) {
      if (!seenIds.has(event.id)) {
        tzevaadomEvents.push(event);
        newCount++;
      }
    }

    if (newCount > 0) {
      fs.writeFileSync(TZEVAADOM_FILE, JSON.stringify(tzevaadomEvents, null, 0));
    }
    return newCount;
  } catch (err) {
    console.error(`  [tzevaadom] Error: ${err.message}`);
    return 0;
  }
}

function rebuildAndSaveWaves() {
  const allAlerts = Object.values(rawAlerts);
  waves = buildWaves(allAlerts);
  fs.writeFileSync(WAVES_FILE, JSON.stringify(waves, null, 2));
  return waves;
}

function triggerRetrain() {
  if (isRetraining) return;

  const completedWaves = waves.filter(w => isWaveComplete(w, MIN_WAVE_CITIES));
  if (completedWaves.length < 1) {
    console.log(`  [retrain] Not enough completed waves (${completedWaves.length}), skipping`);
    return;
  }

  console.log(`  [retrain] Triggering retrain with ${completedWaves.length} completed waves...`);
  isRetraining = true;

  const child = execFile('node', [path.join(__dirname, 'train-model.js')], {
    cwd: __dirname,
    timeout: 120000
  }, (err, stdout, stderr) => {
    isRetraining = false;
    if (err) {
      console.error(`  [retrain] Failed: ${err.message}`);
      if (stderr) console.error(`  [retrain] stderr: ${stderr}`);
    } else {
      console.log(`  [retrain] Success!`);
      if (stdout) stdout.split('\n').filter(Boolean).forEach(l => console.log(`    ${l}`));
    }
  });
}

async function poll() {
  const ts = new Date().toLocaleTimeString('he-IL');

  const [orefNew, tzNew] = await Promise.all([pollOref(), pollTzevaadom()]);

  if (orefNew > 0 || tzNew > 0) {
    console.log(`[${ts}] oref: +${orefNew} (total: ${Object.keys(rawAlerts).length}), tzevaadom: +${tzNew} (total: ${tzevaadomEvents.length})`);

    const prevWaves = waves.length;
    rebuildAndSaveWaves();

    const completedWaves = waves.filter(w => isWaveComplete(w, MIN_WAVE_CITIES));
    const totalAlerts = Object.keys(rawAlerts).length;

    if (completedWaves.length > 0 && totalAlerts !== lastWaveAlertCount) {
      const latest = completedWaves[completedWaves.length - 1];
      if (latest.summary.hasGreen) {
        console.log(`  [waves] ${waves.length} waves, ${completedWaves.length} completed (warned→green)`);
        console.log(`  [waves] Latest: ${latest.summary.warned} warned, ${latest.summary.red} red (${(latest.summary.conversionRate * 100).toFixed(1)}%)`);
        lastWaveAlertCount = totalAlerts;
        triggerRetrain();
      }
    }
  } else {
    process.stdout.write('.');
  }
}

console.log('Alert collector started (oref + tzevaadom)');
console.log(`  Oref alerts: ${Object.keys(rawAlerts).length}`);
console.log(`  Tzevaadom events: ${tzevaadomEvents.length}`);
console.log(`  Waves: ${waves.length}`);
console.log(`  Polling every ${POLL_INTERVAL / 1000}s\n`);

poll();
setInterval(poll, POLL_INTERVAL);
