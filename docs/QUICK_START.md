# Quick Start Guide

## Prerequisites

- **Node.js** >= 16 (check with `node -v`)
- **npm** (comes with Node.js)

## 1. Install Dependencies

```bash
npm install
```

TensorFlow.js native bindings will compile during install. If this fails, the server will still work but will fall back to the distance-based probability curve (no ML predictions).

Verify TensorFlow installed correctly:

```bash
npm list @tensorflow/tfjs-node
```

## 2. Configure Environment (Optional)

Copy the template and edit if needed:

```bash
cp .env.example .env
```

The defaults work out of the box. Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `POLL_INTERVAL` | `30000` | Collector polling interval (ms) |
| `WAVE_GAP_MS` | `1200000` | Wave separation gap (20 min) |
| `TELEGRAM_BOT_TOKEN` | *(empty)* | Optional: Telegram alert notifications |
| `TELEGRAM_CHANNEL_ID` | *(empty)* | Optional: Telegram channel for alerts |

Full list of variables is in `.env.example`.

## 3. Start the System

You need **two** processes running. Open two terminal tabs:

**Terminal 1 -- Server** (serves UI + prediction API):

```bash
npm start
```

You should see:

```
[ML] Model loaded (alpha=0.XX, waves=XX, val_acc=XX.X%)
Live alert map running at http://localhost:3000
```

If no trained model exists yet, it will say `[ML] No trained model found` -- that's fine, it falls back to distance-based predictions.

**Terminal 2 -- Collector** (polls alerts + triggers auto-retraining):

```bash
npm run collect
```

You should see:

```
Alert collector started (oref + tzevaadom)
  Oref alerts: XXXX
  Waves: XX
  Polling every 30s
```

## 4. Open the App

Go to **http://localhost:3000** in your browser.

The map will show live alerts when there's an active event. During quiet periods, the interface shows "no active alerts" with your favorited cities.

## 5. Manual Training (Optional)

Training happens automatically when the collector detects a new completed wave. To trigger it manually:

```bash
npm run train
```

The server auto-reloads the new model via file watcher -- no restart needed.

---

## All npm Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the HTTP server |
| `npm run collect` | Start the alert collector |
| `npm run train` | Manually train the ML model |
| `npm test` | Run unit tests (34 tests) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run check:features` | Print current feature set |
| `npm run validate:model` | Check model/feature compatibility |
| `npm run test:calibration` | Validate model calibration |
| `npm run analyze` | Analyze collected wave data |

---

## Troubleshooting

**"TensorFlow.js not available"**
- Run `npm install` again. If the native build fails, try `npm rebuild @tensorflow/tfjs-node`.
- On Apple Silicon: ensure you have Rosetta or an ARM-compatible build.

**"No trained model found"**
- Normal on first run. The model is created after the collector sees its first completed wave (orange + red + green alerts with 5+ cities).
- To train immediately: ensure `data/collected-alerts.json` has data, then run `npm run train`.

**Server shows old predictions after an event**
1. Check collector is running (`npm run collect` in a separate terminal)
2. Check collector logs for `[retrain] Success!`
3. Check server logs for `[ML] Model files changed, reloading...`

**Port already in use**
- Set a different port: `PORT=3001 npm start`
- Or add `PORT=3001` to your `.env` file

---

## What's Next?

- Star your favorite cities to track them at the top of the live alerts tab
- Check `docs/ARCHITECTURE.md` for how the system works end-to-end
- Check `docs/TECHNICAL.md` for ML model details
- Check `docs/FEATURE_SYSTEM.md` for how to add new ML features
