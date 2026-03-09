# Render.com Deployment Guide

## Quick Start

### 1. Prepare Repository

```bash
# Make sure all files are committed
git add .
git commit -m "Prepare for Render deployment"

# Push to GitHub
git push origin main
```

### 2. Deploy on Render

1. Visit [render.com](https://render.com)
2. Sign up/Login (can use GitHub login)
3. Click **"New +"** → **"Blueprint"**
4. Connect your GitHub account
5. Select your repository
6. Render will detect `render.yaml` automatically
7. Click **"Apply"**

### 3. Monitor Deployment

- **Build logs**: Watch the compilation of TensorFlow.js native bindings (~5 min)
- **Web service**: Will be available at `https://YOUR-SERVICE-NAME.onrender.com`
- **Worker service**: Runs in background, check logs for data collection

### 4. First Time Setup

The collector will automatically:
1. Start polling Oref APIs every 30 seconds
2. Build up historical alert data
3. Detect first complete wave (orange→red→green sequence)
4. Train initial ML model
5. Continue improving with each new wave

## Configuration

All configuration is in `render.yaml`. Key settings:

### Web Service
- **Port**: Automatically set by Render (`process.env.PORT`)
- **Build**: `npm install` (includes TensorFlow.js compilation)
- **Start**: `node server.js`

### Worker Service
- **Build**: Same as web service
- **Start**: `node collector.js`
- **Runs continuously**: Polls every 30s, trains on new waves

### Shared Persistent Disk
- **Name**: `alert-data`
- **Size**: 1GB (free tier)
- **Mount**: `/app/data` (currently stored in project root, auto-migrates)
- **Contains**:
  - `collected-alerts.json` (~11k+ alerts)
  - `collected-waves.json` (structured waves for ML)
  - `collected-tzevaadom.json` (red alert events)
  - `model/` directory (trained TF.js model + metrics)

## Environment Variables

Currently none required. All URLs and settings are hardcoded. If you need to add any:

```yaml
envVars:
  - key: YOUR_VAR
    value: your_value
```

## Monitoring

### Check Web Service
```bash
# Visit your URL
https://pikud-alert-map.onrender.com
```

### Check Logs
1. Go to Render dashboard
2. Select your service
3. Click "Logs" tab
4. Look for:
   - `[Server] Listening on port XXX`
   - `[ML] Model loaded (alpha=0.XX, waves=XX)`
   - `[Collector] Polling...`
   - `[Collector] Wave completed, triggering retrain`

### Check ML Model Status
```bash
# Via API
https://your-service.onrender.com/api/model-info
```

## Troubleshooting

### Build Fails
- **Cause**: TensorFlow.js native compilation issues
- **Fix**: Usually auto-resolves on rebuild. Click "Manual Deploy" → "Clear build cache & deploy"

### Collector Not Running
- **Cause**: Worker service not started
- **Fix**: Check Render dashboard → Worker service → Should show "Running"

### Model Not Training
- **Cause**: Need at least 1 complete wave (orange→red→green)
- **Wait**: Can take hours/days depending on real-world alert frequency
- **Check**: `/api/model-info` will show `loaded: false` until first training

### Data Loss
- **Cause**: Persistent disk not properly mounted
- **Fix**: Verify disk name matches in render.yaml for both services

## Cost & Limits

### Free Tier
- **Runtime**: 750 hours/month total (both services combined)
- **Storage**: 1GB persistent disk
- **Bandwidth**: 100GB/month
- **Builds**: Unlimited

### Usage Estimate
- **Web service**: ~730 hours/month (full-time)
- **Worker service**: ~20 hours/month (minimal CPU when idle)
- **Total**: ~750 hours/month ✅ Fits free tier!

### If You Exceed
- Services will sleep until next month
- Upgrade to paid tier ($7/month) for unlimited runtime

## Scaling for More Users

If traffic grows beyond friends:

1. **Keep free tier**: Render's free tier can handle ~100 concurrent users
2. **Upgrade web service only** ($7/month): Handles thousands of users
3. **Optimize**: Add caching, CDN for static files (Cloudflare free tier)

## Security Notes

- All API endpoints are public (no authentication needed)
- Oref data is public information
- No sensitive data stored
- HTTPS enabled by default on Render

## Updating

To deploy updates:

```bash
# Make changes locally
git add .
git commit -m "Your changes"
git push origin main
```

Render will automatically:
1. Detect the push
2. Rebuild both services
3. Deploy with zero downtime (web service)
4. Restart worker

## Alternative: Manual Deploy

If you don't want GitHub integration:

1. Render dashboard → "New +" → "Web Service"
2. Choose "Docker" or "Build from source"
3. Manually upload your code
4. Repeat for Worker service

(Not recommended - loses auto-deploy benefits)
