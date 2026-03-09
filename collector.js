const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TZEVAADOM_URL = 'https://api.tzevaadom.co.il/alerts-history';
const OREF_HISTORY_URL = 'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json';
const FULL_HISTORY_URL = 'https://alerts-history.oref.org.il/Shared/Ajax/GetAlarmsHistory.aspx?lang=he&mode=1';

const PROXY_LIST = [
  'http://proxy.toolip.gr:3128',
  'http://proxy1.toolip.gr:3128',
  'http://proxy2.toolip.gr:3128',
  'http://proxy3.toolip.gr:3128',
  'http://proxy4.toolip.gr:3128'
];

let currentProxyIndex = 0;

const RAW_FILE = path.join(__dirname, 'collected-alerts.json');
const WAVES_FILE = path.join(__dirname, 'collected-waves.json');
const TZEVAADOM_FILE = path.join(__dirname, 'collected-tzevaadom.json');

const POLL_INTERVAL = 30000;
const WAVE_GAP_MS = 20 * 60 * 1000;

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

function alertKey(a) {
  return `${a.alertDate}|${a.data}|${a.title}`;
}

// ── Group raw alerts into waves ──
function buildWaves(alerts) {
  const parsed = alerts
    .filter(a => a.alertDate)
    .map(a => {
      const dateStr = a.alertDate.includes('T') ? a.alertDate : a.alertDate.replace(' ', 'T');
      return { ...a, time: new Date(dateStr).getTime() };
    })
    .filter(a => !isNaN(a.time))
    .sort((a, b) => a.time - b.time);

  if (parsed.length === 0) return [];

  const result = [];
  let current = [parsed[0]];

  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].time - parsed[i - 1].time > WAVE_GAP_MS) {
      result.push(processWave(current));
      current = [];
    }
    current.push(parsed[i]);
  }
  if (current.length > 0) result.push(processWave(current));

  return result;
}

function isOrange(title) { return title.includes('בדקות הקרובות'); }
function isRed(title) { return title.includes('ירי רקטות וטילים') && !title.includes('האירוע הסתיים'); }
function isGreen(title) {
  return title.includes('האירוע הסתיים') || title.includes('ניתן לצאת');
}

function processWave(alerts) {
  const cityMap = {};
  for (const a of alerts) {
    if (!cityMap[a.data]) cityMap[a.data] = { orange: false, red: false, green: false, times: {} };
    const entry = cityMap[a.data];
    if (isOrange(a.title)) { entry.orange = true; entry.times.orange = a.alertDate; }
    if (isRed(a.title)) { entry.red = true; entry.times.red = a.alertDate; }
    if (isGreen(a.title)) { entry.green = true; entry.times.green = a.alertDate; }
  }

  const startTime = alerts[0].alertDate;
  const endTime = alerts[alerts.length - 1].alertDate;
  const orangeCities = Object.keys(cityMap).filter(c => cityMap[c].orange || cityMap[c].green);
  const redCities = Object.keys(cityMap).filter(c => cityMap[c].red);

  return {
    id: `wave_${alerts[0].time}`,
    startTime,
    endTime,
    alertCount: alerts.length,
    cities: cityMap,
    summary: {
      warned: orangeCities.length,
      red: redCities.length,
      conversionRate: orangeCities.length > 0 ? (redCities.length / orangeCities.length) : 0,
      hasGreen: Object.values(cityMap).some(c => c.green)
    }
  };
}

// ── Polling ──
async function fetchWithProxy(url, headers, isBuffer = false) {
  const proxy = PROXY_LIST[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % PROXY_LIST.length;
  
  try {
    const agent = new HttpsProxyAgent(proxy);
    const res = await axios.get(url, {
      headers,
      httpsAgent: agent,
      httpAgent: agent,
      responseType: isBuffer ? 'arraybuffer' : 'json',
      timeout: 15000
    });
    return res;
  } catch (err) {
    if (currentProxyIndex === 0) throw err;
    const nextProxy = PROXY_LIST[currentProxyIndex];
    const agent = new HttpsProxyAgent(nextProxy);
    const res = await axios.get(url, {
      headers,
      httpsAgent: agent,
      httpAgent: agent,
      responseType: isBuffer ? 'arraybuffer' : 'json',
      timeout: 15000
    });
    return res;
  }
}

async function pollOref() {
  let totalNew = 0;
  const headers = {
    'Referer': 'https://www.oref.org.il/',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  try {
    const res = await fetchWithProxy(OREF_HISTORY_URL, headers, true);
    let text = Buffer.from(res.data).toString('utf8').replace(/^\uFEFF/, '');
    if (text && text.trim() !== '' && text.trim() !== '[]') {
      const alerts = JSON.parse(text);
      for (const a of alerts) {
        const key = alertKey(a);
        if (!rawAlerts[key]) { rawAlerts[key] = a; totalNew++; }
      }
    }
  } catch (err) {
    console.error(`  [oref-short] ${err.message}`);
  }

  try {
    const fullHeaders = {
      'Referer': 'https://alerts-history.oref.org.il/12481-he/Pakar.aspx',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    const res = await fetchWithProxy(FULL_HISTORY_URL, fullHeaders, false);
    const alerts = res.data;
    if (Array.isArray(alerts)) {
      for (const a of alerts) {
        const converted = {
          alertDate: a.date.split('.').reverse().join('-') + ' ' + a.time,
          title: a.category_desc,
          data: a.data,
          category: a.category,
          category_desc: a.category_desc
        };
        const key = alertKey(converted);
        if (!rawAlerts[key]) { rawAlerts[key] = converted; totalNew++; }
      }
    }
  } catch (err) {
    console.error(`  [oref-full] ${err.message}`);
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
    let newAlertsAdded = 0;

    for (const event of events) {
      if (!seenIds.has(event.id)) {
        tzevaadomEvents.push(event);
        newCount++;
        
        // Convert Tzevaadom event to alert format and add to rawAlerts
        const alert = {
          alertDate: event.time,
          title: event.isDrill ? 'תרגיל' : 'ירי רקטות וטילים',
          data: event.city,
          category: 1,
          category_desc: event.isDrill ? 'תרגיל' : 'ירי רקטות וטילים'
        };
        const key = alertKey(alert);
        if (!rawAlerts[key]) {
          rawAlerts[key] = alert;
          newAlertsAdded++;
        }
      }
    }

    if (newCount > 0) {
      fs.writeFileSync(TZEVAADOM_FILE, JSON.stringify(tzevaadomEvents, null, 0));
      if (newAlertsAdded > 0) {
        fs.writeFileSync(RAW_FILE, JSON.stringify(rawAlerts, null, 0));
      }
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

  const completedWaves = waves.filter(w => w.summary.hasGreen && w.summary.warned >= 5);
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

    const completedWaves = waves.filter(w => w.summary.hasGreen && w.summary.warned >= 5);
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
