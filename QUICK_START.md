# Quick Start Guide

## 🚀 Get Running in 5 Minutes

### Prerequisites
- Node.js v16+ installed
- Terminal access

### Steps

```bash
# 1. Navigate to project
cd /Users/liran.goldstein/Cursor-hubs/pikud

# 2. Install dependencies (if not already done)
npm install

# 3. Start the server (Terminal 1)
node server.js
# Should see: "Live alert map running at http://localhost:3000"

# 4. Start the collector (Terminal 2)
node collector.js
# Should see: "Alert collector started (oref + tzevaadom)"

# 5. Open browser
open http://localhost:3000
```

That's it! You're now running the full system.

---

## 🎮 Using the Interface

### Live Alerts Tab (התרעות חיות)
- **Auto-refreshes every 5 seconds**
- Click **star (☆)** next to any city to favorite it
- Favorited cities appear at the top with current status
- Orange alerts show **probability %** of turning red
- Map automatically centers on active alerts

### History Tab (היסטוריה)
- **Search** for any city
- Click **time window** buttons (24h, 3 days, week, month)
- See **conversion rates** (orange→red probability)
- View **daily trends** and timeline

### Leaderboard Tab (טבלת מובילים)
- Toggle between **red** and **orange** alerts
- Adjust **time window**
- Click any city to jump to its history
- Click **star** to favorite a city

---

## 📊 Monitoring System Health

### Check if Collector is Running
```bash
ps aux | grep "node collector.js"
```

### Check if Server is Running
```bash
lsof -i :3000
```

### View Recent Collector Activity
```bash
cd /Users/liran.goldstein/Cursor-hubs/pikud
tail -f collector.log
```

### Check Current Model Status
```bash
cat model/metrics.json | grep -E "trainedAt|wavesUsed|accuracy|alpha"
```

### See How Much Data Collected
```bash
node -e "console.log('Alerts:', Object.keys(require('./collected-alerts.json')).length, '| Waves:', require('./collected-waves.json').length)"
```

---

## 🔄 Restarting Everything

```bash
# Kill all running processes
pkill -f "node server.js"
pkill -f "node collector.js"

# Restart
node server.js &
node collector.js &

# Check they're running
ps aux | grep "node.*\.js"
```

---

## 🧪 Testing the System

### During Active Alerts
1. Open browser to `http://localhost:3000`
2. Watch **Live Alerts** tab update every 5s
3. Check if **orange cities show probabilities**
4. Verify **favorites section** shows your starred cities

### After Event Ends (Green Alerts)
1. Check collector logs for: `[retrain] Triggering retrain`
2. Wait ~15 seconds for training to complete
3. Look for: `[retrain] Success!`
4. Server should show: `[ML] Model files changed, reloading...`
5. Check new accuracy: `cat model/metrics.json | grep accuracy`

### Manual Training Test
```bash
# Trigger training manually
node train-model.js

# Check output for:
# - Best validation accuracy
# - Blend alpha value
# - "Training Complete" message
```

---

## ❗ Common Issues

### "Cannot find module @tensorflow/tfjs-node"
```bash
npm install
```

### Port 3000 Already in Use
```bash
lsof -ti:3000 | xargs kill -9
node server.js
```

### No Predictions Showing
Check console in browser (F12) for errors. Make sure:
1. Server is running
2. Model is loaded (check server logs)
3. There are active orange alerts

### Collector Not Detecting Waves
Check:
```bash
# Are new alerts being added?
ls -lh collected-alerts.json

# Are waves being built?
node -e "const w=require('./collected-waves.json'); console.log('Last wave:', w[w.length-1].endTime)"
```

---

## 📱 Quick Commands Reference

```bash
# Start server
node server.js

# Start collector
node collector.js

# Manual training
node train-model.js

# Check model status
cat model/metrics.json

# Count data
node -e "console.log('Alerts:', Object.keys(require('./collected-alerts.json')).length)"

# View last 10 waves
node -e "const w=require('./collected-waves.json'); w.slice(-10).forEach(x => console.log(x.startTime, '→', x.summary))"

# Kill everything
pkill -f "node.*\.js"
```

---

## 🎯 Next Steps

Once comfortable with the basics:

1. Read the full [README.md](README.md) for architecture details
2. Review [TECHNICAL.md](TECHNICAL.md) for ML internals
3. Check `train-model.js` to understand feature engineering
4. Explore `server.js` to see prediction blending logic
5. Look at `index.html` for UI rendering code

---

## 💡 Pro Tips

- **Favorite your city** immediately so you can track it
- **Leave it running** during active periods to collect more data
- **Check model metrics** after each retraining to see improvement
- **Use history tab** to analyze past events and validate predictions
- **Monitor collector logs** to see the system learning in real-time

---

**Need Help?** Check the full documentation in [README.md](README.md)
