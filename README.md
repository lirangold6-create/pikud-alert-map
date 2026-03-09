# Pikud HaOref Alert Map 🚨

Real-time alert map with ML-powered red alert probability prediction for Israel's Home Front Command alerts.

## Features

- **Live Alert Map**: Real-time visualization of active alerts with color-coded severity
- **ML Prediction**: Predicts probability of red alert following orange warning alerts
- **Alert History**: Browse historical alerts by city with time window selection
- **Continuous Learning**: ML model automatically improves with each new alert wave
- **Conversion Analytics**: Statistical analysis of orange→red alert patterns

## Deployment to Render.com

### Prerequisites
- GitHub account
- Render.com account (free tier, no credit card required)

### Steps

1. **Initialize Git Repository** (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Push to GitHub**:
   ```bash
   # Create a new repo on GitHub, then:
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git branch -M main
   git push -u origin main
   ```

3. **Deploy on Render**:
   - Go to [Render.com](https://render.com) and sign up/login
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository
   - Render will automatically detect `render.yaml` and create both services:
     - **Web Service** (pikud-alert-map): Your map UI and API
     - **Background Worker** (pikud-collector): Data collection and ML training
   - Click "Apply" to deploy

4. **Wait for Build**:
   - Initial build takes ~5-10 minutes (compiling TensorFlow.js native bindings)
   - Both services will share a persistent disk for data and ML models
   - Collector will start gathering data and training the model

5. **Access Your Map**:
   - Your web service URL: `https://pikud-alert-map.onrender.com`
   - Share this link with friends!

### Architecture

```
┌─────────────────────────────────────────┐
│  Web Service (server.js)                │
│  • Serves map UI                        │
│  • API endpoints (/api/alerts, etc)    │
│  • ML predictions                       │
└─────────────────┬───────────────────────┘
                  │ shared persistent disk
┌─────────────────┴───────────────────────┐
│  Background Worker (collector.js)       │
│  • Polls Oref APIs every 30s           │
│  • Detects alert waves                  │
│  • Triggers ML retraining               │
└─────────────────────────────────────────┘
```

## Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run locally**:
   ```bash
   # Terminal 1: Start web server
   npm run serve

   # Terminal 2: Start collector
   npm run collect
   ```

3. **Open**: http://localhost:3000

## Tech Stack

- **Backend**: Node.js, Express
- **ML**: TensorFlow.js (Node)
- **Frontend**: Vanilla JS, Leaflet.js
- **Data**: Pikud HaOref APIs, Tzevaadom API

## How ML Works

1. **Data Collection**: Collector gathers orange warnings, red alerts, and "all clear" events
2. **Wave Detection**: Groups related alerts within 20-minute windows
3. **Feature Engineering**: Extracts geographical, temporal, and historical features
4. **Model Training**: 3-layer neural network trained on wave patterns
5. **Alpha Blending**: Combines ML predictions with distance-based fallback
6. **Continuous Improvement**: Retrains automatically with each new completed wave

## Free Tier Limits

Render free tier provides:
- 750 hours/month combined runtime
- 1GB persistent disk
- Always-on (no sleeping)

This is enough for both services to run 24/7 for ~15 days, or one service full-time + occasional use of the second.

## License

MIT
