const puppeteer = require('puppeteer-core');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCREENSHOT_DIR = path.join(__dirname, '../../data/screenshots');
const PORT = process.env.PORT || 3000;

const REGION_NAMES_HE = {
  JERUSALEM_SHOMRON: 'אזור ירושלים והשומרון',
  TEL_AVIV_CENTER: 'אזור תל אביב והמרכז',
  NORTH: 'אזור הצפון',
  SOUTH: 'אזור הדרום',
  OTHER: 'אזור לא מזוהה'
};

const EDIT_COOLDOWN_MS = 30 * 1000;
const TELEGRAM_CAPTION_LIMIT = 1024;

let wave = {
  active: false,
  orangeMsg: null,      // { id, isPhoto } — message 1: percentages (edited)
  redMsg: null,          // { id } — message 2: sirens (sent once)
  favProbs: {},
  lastEditAt: 0
};
let sending = false;

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!token || !channelId) return null;
  return { token, channelId };
}

function getFavProbs(favorites, predictions) {
  const probs = {};
  for (const fav of (favorites || [])) {
    const p = predictions[fav];
    if (p) probs[fav] = p.prob;
  }
  return probs;
}

function hasFavInPredictions(favorites, predictions) {
  return (favorites || []).some(f => predictions[f] && predictions[f].prob >= 20);
}

function probsChanged(favorites, predictions) {
  const current = getFavProbs(favorites, predictions);
  const prev = wave.favProbs;
  for (const city of Object.keys(current)) {
    const oldProb = prev[city] ?? 0;
    if (Math.abs(current[city] - oldProb) >= 1) return true;
  }
  return false;
}

const WAVE_GAP_MS = 20 * 60 * 1000;

function resetIfWaveEnded(orangeCities) {
  if (!wave.active) return;
  const stale = wave.lastEditAt > 0 && (Date.now() - wave.lastEditAt) > WAVE_GAP_MS;
  if (orangeCities.length === 0 || stale) {
    wave = { active: false, orangeMsg: null, redMsg: null, favProbs: {}, lastEditAt: 0 };
  }
}

// ── Map screenshot (polygon only, no sidebar) ──

async function captureMapScreenshot() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2', timeout: 20000 });
    await new Promise(r => setTimeout(r, 15000));

    await page.evaluate(() => {
      const panel = document.getElementById('panel');
      if (panel) panel.style.display = 'none';
    });
    await new Promise(r => setTimeout(r, 2000));

    const ts = Date.now();
    const mapPath = path.join(SCREENSHOT_DIR, `map-${ts}.png`);
    await page.screenshot({ path: mapPath, type: 'png' });

    return mapPath;
  } finally {
    await browser.close();
  }
}

function cleanupScreenshots() {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) return;
    const files = fs.readdirSync(SCREENSHOT_DIR).sort().reverse();
    for (const f of files.slice(20)) fs.unlinkSync(path.join(SCREENSHOT_DIR, f));
  } catch (_) {}
}

// ── Message building ──

function buildPercentagesMessage(orangeCities, redCities, favorites, predictions, attackPattern) {
  const lines = [];
  const now = new Date();
  const timeStr = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('he-IL');

  const region = attackPattern && attackPattern.primaryRegion
    ? REGION_NAMES_HE[attackPattern.primaryRegion] || ''
    : '';
  const areaStr = region ? ` — ${region}` : '';

  lines.push(`🚨 *התרעה פעילה${areaStr} — ${timeStr}*`);
  lines.push(`📅 ${dateStr}`);
  lines.push('');
  lines.push(`🟠 *${orangeCities.length}* ישובים באזור התרעה`);
  if (redCities.length > 0) lines.push(`🔴 *${redCities.length}* אזעקות פעילות`);

  if (favorites && favorites.length > 0) {
    const favEntries = favorites
      .map(fav => {
        const pred = predictions[fav];
        if (!pred) return null;
        return { name: fav, prob: pred.prob };
      })
      .filter(Boolean)
      .sort((a, b) => b.prob - a.prob);

    if (favEntries.length > 0) {
      lines.push('');
      lines.push('⭐ *סיכויי אזעקה — ערים מועדפות:*');
      for (const { name, prob } of favEntries) {
        const bar = prob >= 70 ? '🔴' : prob >= 40 ? '🟠' : prob >= 20 ? '🟡' : '🟢';
        const status = prob >= 70 ? 'סיכון גבוה' : prob >= 40 ? 'סיכון בינוני' : prob >= 20 ? 'סיכון נמוך' : 'בטוח';
        lines.push(`${bar} *${name}*: ${prob}% — ${status}`);
      }
    }
  }

  return lines.join('\n');
}

function buildRedAlertMessage(orangeCities, redCities, favorites, attackPattern) {
  const lines = [];
  const now = new Date();
  const timeStr = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  const region = attackPattern && attackPattern.primaryRegion
    ? REGION_NAMES_HE[attackPattern.primaryRegion] || ''
    : '';
  const areaStr = region ? ` — ${region}` : '';

  lines.push(`🔴 *אזעקות פעילות${areaStr} — ${timeStr}*`);
  lines.push('');
  lines.push(`🔴 *${redCities.length}* אזעקות (ירי רקטות וטילים)`);
  lines.push(`🟠 *${orangeCities.length}* ישובים באזור התרעה`);

  const redFavs = (favorites || []).filter(f => redCities.includes(f));
  if (redFavs.length > 0) {
    lines.push('');
    lines.push('🚨 *אזעקה בערים מועדפות:*');
    for (const f of redFavs) lines.push(`• ${f}`);
  }

  return lines.join('\n');
}

// ── Telegram API ──

async function sendPhoto(photoPath, caption) {
  const config = getConfig();
  if (!config) return null;
  try {
    const form = new FormData();
    form.append('chat_id', config.channelId);
    form.append('photo', fs.createReadStream(photoPath));
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'Markdown');
    }
    const res = await axios.post(`https://api.telegram.org/bot${config.token}/sendPhoto`, form, {
      headers: form.getHeaders(), timeout: 15000
    });
    return res.data && res.data.result ? res.data.result.message_id : null;
  } catch (err) {
    if (caption && err.response && err.response.status === 400) {
      const form2 = new FormData();
      form2.append('chat_id', config.channelId);
      form2.append('photo', fs.createReadStream(photoPath));
      form2.append('caption', caption.replace(/\*/g, ''));
      const res = await axios.post(`https://api.telegram.org/bot${config.token}/sendPhoto`, form2, {
        headers: form2.getHeaders(), timeout: 15000
      });
      return res.data && res.data.result ? res.data.result.message_id : null;
    }
    throw err;
  }
}

async function sendText(text) {
  const config = getConfig();
  if (!config) return null;
  try {
    const res = await axios.post(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      chat_id: config.channelId, text, parse_mode: 'Markdown'
    }, { timeout: 10000 });
    return res.data && res.data.result ? res.data.result.message_id : null;
  } catch (err) {
    if (err.response && err.response.status === 400) {
      const res = await axios.post(`https://api.telegram.org/bot${config.token}/sendMessage`, {
        chat_id: config.channelId, text: text.replace(/\*/g, '')
      }, { timeout: 10000 });
      return res.data && res.data.result ? res.data.result.message_id : null;
    }
    throw err;
  }
}

async function editCaption(messageId, caption) {
  const config = getConfig();
  if (!config || !messageId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${config.token}/editMessageCaption`, {
      chat_id: config.channelId, message_id: messageId, caption, parse_mode: 'Markdown'
    }, { timeout: 10000 });
    return true;
  } catch (err) {
    if (err.response && err.response.status === 400) {
      try {
        await axios.post(`https://api.telegram.org/bot${config.token}/editMessageCaption`, {
          chat_id: config.channelId, message_id: messageId, caption: caption.replace(/\*/g, '')
        }, { timeout: 10000 });
        return true;
      } catch (_) {}
    }
    console.error('[Telegram] Edit caption failed:', err.message);
    return false;
  }
}

async function editText(messageId, text) {
  const config = getConfig();
  if (!config || !messageId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${config.token}/editMessageText`, {
      chat_id: config.channelId, message_id: messageId, text, parse_mode: 'Markdown'
    }, { timeout: 10000 });
    return true;
  } catch (err) {
    if (err.response && err.response.status === 400) {
      try {
        await axios.post(`https://api.telegram.org/bot${config.token}/editMessageText`, {
          chat_id: config.channelId, message_id: messageId, text: text.replace(/\*/g, '')
        }, { timeout: 10000 });
        return true;
      } catch (_) {}
    }
    console.error('[Telegram] Edit text failed:', err.message);
    return false;
  }
}

// ── Send/edit helpers ──

async function sendNewPhotoMessage(text) {
  let msgId = null;
  let isPhoto = false;
  try {
    const mapPath = await captureMapScreenshot();
    if (text.length <= TELEGRAM_CAPTION_LIMIT) {
      msgId = await sendPhoto(mapPath, text);
      isPhoto = true;
    } else {
      msgId = await sendText(text);
      await sendPhoto(mapPath, null);
    }
    cleanupScreenshots();
  } catch (err) {
    console.error('[Telegram] Screenshot failed, sending text only:', err.message);
    msgId = await sendText(text);
  }
  return { id: msgId, isPhoto };
}

async function editExistingMessage(msg, text) {
  if (!msg || !msg.id) return false;
  return msg.isPhoto
    ? await editCaption(msg.id, text.slice(0, TELEGRAM_CAPTION_LIMIT))
    : await editText(msg.id, text);
}

// ── Main entry ──

async function notifyOrangeWave(orangeCities, redCities, favorites, predictions, multiMissile, attackPattern) {
  if (sending) return;

  resetIfWaveEnded(orangeCities);

  const config = getConfig();
  if (!config) return;
  if (orangeCities.length < 5) return;
  if (!favorites || favorites.length === 0) return;
  if (!hasFavInPredictions(favorites, predictions)) return;

  const now = Date.now();

  // Message 1: Percentages — send once, then edit
  if (!wave.active) {
    sending = true;
    console.log(`[Telegram] Sending percentages (${orangeCities.length} orange, ${redCities.length} red)`);
    try {
      const text = buildPercentagesMessage(orangeCities, redCities, favorites, predictions, attackPattern);
      wave.orangeMsg = await sendNewPhotoMessage(text);
      wave.favProbs = getFavProbs(favorites, predictions);
      wave.lastEditAt = now;
      wave.active = true;
      console.log('[Telegram] Percentages message sent');
    } catch (err) {
      console.error('[Telegram] Failed to send percentages:', err.message);
    } finally {
      sending = false;
    }
    return;
  }

  // Message 2: Red alert — send once when a FAVORITE city gets a red alert
  const redFavs = (favorites || []).filter(f => redCities.includes(f));
  if (!wave.redMsg && redFavs.length > 0) {
    sending = true;
    console.log(`[Telegram] Sending red alert (${redCities.length} red)`);
    try {
      const text = buildRedAlertMessage(orangeCities, redCities, favorites, attackPattern);
      const msg = await sendNewPhotoMessage(text);
      wave.redMsg = msg;
      console.log('[Telegram] Red alert message sent');
    } catch (err) {
      console.error('[Telegram] Failed to send red alert:', err.message);
    } finally {
      sending = false;
    }
  }

  // Edit message 1 with updated percentages (stop once red alert is sent)
  if (wave.orangeMsg && !wave.redMsg && (now - wave.lastEditAt) >= EDIT_COOLDOWN_MS && probsChanged(favorites, predictions)) {
    sending = true;
    try {
      const text = buildPercentagesMessage(orangeCities, redCities, favorites, predictions, attackPattern);
      const edited = await editExistingMessage(wave.orangeMsg, text);
      if (edited) {
        wave.favProbs = getFavProbs(favorites, predictions);
        wave.lastEditAt = now;
        console.log('[Telegram] Percentages edited');
      }
    } catch (err) {
      console.error('[Telegram] Failed to edit percentages:', err.message);
    } finally {
      sending = false;
    }
  }
}

module.exports = { notifyOrangeWave };
