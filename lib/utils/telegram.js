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
const PROB_CHANGE_THRESHOLD = 1;
const TELEGRAM_CAPTION_LIMIT = 1024;

let lastState = { favProbs: {}, sentAt: 0, sentOrange: false, sentRed: false, messageId: null };
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
  return (favorites || []).some(f => predictions[f] && predictions[f].prob >= 5);
}

function shouldNotify(orangeCities, redCities, favorites, predictions) {
  const now = Date.now();
  const sinceLastSend = now - lastState.sentAt;

  if (!hasFavInPredictions(favorites, predictions)) return null;

  // New wave — send immediately
  if (!lastState.sentOrange) return 'orange';

  // Reds appeared — send new message immediately
  if (!lastState.sentRed && redCities.length > 0) return 'red';

  // Edits: just a short API cooldown since edits are silent
  if (sinceLastSend < EDIT_COOLDOWN_MS) return null;

  const current = getFavProbs(favorites, predictions);
  const prev = lastState.favProbs;
  for (const city of Object.keys(current)) {
    const oldProb = prev[city] ?? 0;
    if (Math.abs(current[city] - oldProb) >= PROB_CHANGE_THRESHOLD) return 'update';
  }

  return null;
}

function resetIfWaveEnded(orangeCities) {
  if (orangeCities.length === 0 && lastState.sentOrange) {
    lastState = { favProbs: {}, sentAt: 0, sentOrange: false, sentRed: false, messageId: null };
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

function resolveAreaName(orangeCities, multiMissile, attackPattern) {
  if (multiMissile && multiMissile.detected && multiMissile.clusters) {
    const regions = multiMissile.clusters
      .map(c => c.seedName || '')
      .filter(Boolean);
    if (regions.length > 0) return regions.join(' + ');
  }
  if (attackPattern && attackPattern.primaryRegion) {
    return REGION_NAMES_HE[attackPattern.primaryRegion] || attackPattern.primaryRegion;
  }
  return null;
}

function buildMessage(orangeCities, redCities, favorites, predictions, multiMissile, attackPattern) {
  const lines = [];
  const now = new Date();
  const timeStr = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('he-IL');

  const area = resolveAreaName(orangeCities, multiMissile, attackPattern);
  const areaStr = area ? ` — ${area}` : '';

  lines.push(`🚨 *התרעה פעילה${areaStr} — ${timeStr}*`);
  lines.push(`📅 ${dateStr}`);
  lines.push('');
  lines.push(`🟠 *${orangeCities.length}* ישובים באזור התרעה`);
  if (redCities.length > 0) lines.push(`🔴 *${redCities.length}* אזעקות פעילות (ירי רקטות)`);

  if (multiMissile && multiMissile.detected) {
    lines.push('');
    lines.push(`⚠️ *${multiMissile.clusterCount} טילים זוהו* — מרחק ${multiMissile.separation} ק"מ`);
    multiMissile.clusters.forEach((c, i) => {
      lines.push(`  🚀 טיל ${i + 1}: ${c.seedName} (${c.size} ישובים)`);
    });
  }

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

  const redFavs = (favorites || []).filter(f => redCities.includes(f));
  if (redFavs.length > 0) {
    lines.push('');
    lines.push('🔴 *אזעקה בערים מועדפות:*');
    for (const f of redFavs) lines.push(`• ${f}`);
  }

  return lines.join('\n');
}

// ── Telegram API ──

async function sendPhoto(photoPath, caption) {
  const config = getConfig();
  if (!config) return null;
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
}

async function sendText(text) {
  const config = getConfig();
  if (!config) return null;
  const res = await axios.post(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    chat_id: config.channelId, text, parse_mode: 'Markdown'
  }, { timeout: 10000 });
  return res.data && res.data.result ? res.data.result.message_id : null;
}

async function editCaption(messageId, caption) {
  const config = getConfig();
  if (!config || !messageId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${config.token}/editMessageCaption`, {
      chat_id: config.channelId,
      message_id: messageId,
      caption,
      parse_mode: 'Markdown'
    }, { timeout: 10000 });
    return true;
  } catch (err) {
    console.error('[Telegram] Edit failed:', err.message);
    return false;
  }
}

async function editText(messageId, text) {
  const config = getConfig();
  if (!config || !messageId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${config.token}/editMessageText`, {
      chat_id: config.channelId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown'
    }, { timeout: 10000 });
    return true;
  } catch (err) {
    console.error('[Telegram] Edit failed:', err.message);
    return false;
  }
}

// ── Main entry ──

async function notifyOrangeWave(orangeCities, redCities, favorites, predictions, multiMissile, attackPattern) {
  if (sending) return;

  resetIfWaveEnded(orangeCities);

  const config = getConfig();
  if (!config) return;
  if (orangeCities.length < 5) return;
  if (!favorites || favorites.length === 0) return;

  const reason = shouldNotify(orangeCities, redCities, favorites, predictions);
  if (!reason) return;

  sending = true;
  lastState.sentAt = Date.now();

  console.log(`[Telegram] ${reason === 'update' ? 'Editing' : 'Sending'} (reason: ${reason}, ${orangeCities.length} orange, ${redCities.length} red)`);

  try {
    const message = buildMessage(orangeCities, redCities, favorites, predictions, multiMissile, attackPattern);

    if (reason === 'update' && lastState.messageId) {
      // Edit the existing message instead of sending a new one
      const isPhoto = lastState.messageIsPhoto;
      const edited = isPhoto
        ? await editCaption(lastState.messageId, message.slice(0, TELEGRAM_CAPTION_LIMIT))
        : await editText(lastState.messageId, message);

      if (edited) {
        lastState.favProbs = getFavProbs(favorites, predictions);
        lastState.sentAt = Date.now();
        console.log('[Telegram] Message edited');
      } else {
        console.log('[Telegram] Edit failed, sending new message');
        const msgId = await sendText(message);
        lastState.messageId = msgId;
        lastState.messageIsPhoto = false;
        lastState.favProbs = getFavProbs(favorites, predictions);
        lastState.sentAt = Date.now();
      }
    } else {
      // New message: send photo + caption for orange/red milestones
      let msgId = null;
      let isPhoto = false;

      try {
        const mapPath = await captureMapScreenshot();
        if (message.length <= TELEGRAM_CAPTION_LIMIT) {
          msgId = await sendPhoto(mapPath, message);
          isPhoto = true;
        } else {
          msgId = await sendText(message);
          await sendPhoto(mapPath, null);
        }
        cleanupScreenshots();
      } catch (screenshotErr) {
        console.error('[Telegram] Screenshot failed, sending text only:', screenshotErr.message);
        msgId = await sendText(message);
      }

      lastState.favProbs = getFavProbs(favorites, predictions);
      lastState.sentAt = Date.now();
      lastState.messageId = msgId;
      lastState.messageIsPhoto = isPhoto;
      if (reason === 'orange') {
        lastState.sentOrange = true;
        if (redCities.length > 0) lastState.sentRed = true;
      }
      if (reason === 'red') lastState.sentRed = true;

      console.log('[Telegram] Notification sent');
    }
  } catch (err) {
    console.error('[Telegram] Notification failed:', err.message);
  } finally {
    sending = false;
  }
}

module.exports = { notifyOrangeWave };
