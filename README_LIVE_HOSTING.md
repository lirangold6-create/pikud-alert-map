# Live Hosting Branch - Deployment Ready

This branch (`live-hosting`) is specifically configured for production deployment to Render.com's free tier.

---

## 🔄 Branch Differences

### `main` vs `old-local` vs `live-hosting`

| Aspect | `main` | `old-local` | `live-hosting` |
|--------|--------|-------------|----------------|
| **Purpose** | Local development | Backup copy | Production deploy |
| **Model files** | ❌ Ignored | ❌ Ignored | ✅ **Included** |
| **PORT config** | `3000` | `3000` | `process.env.PORT \|\| 3000` |
| **axios dependency** | Submodule path | Submodule path | npm package |
| **Deploy files** | ❌ None | ❌ None | ✅ render.yaml |
| **Updates** | Active dev | Never | Deploy only |

---

## 🎯 What Makes This Branch Special

### 1. Pre-Trained ML Model Included ⭐

**Why:** Avoid slow training on free tier servers

**Files committed to git:**
```
model/
├── model.json         (2.2 KB)  - Network architecture
├── weights.bin        (3.8 KB)  - Trained weights
├── normalization.json (875 B)   - Feature scaling
└── metrics.json       (1.1 KB)  - Performance metrics
```

**Performance:**
- ✅ **86.8% validation accuracy**
- ✅ Trained on 63 completed waves (4,193 samples)
- ✅ 70% ML + 30% distance blend (alpha=0.7)
- ✅ Predictions available immediately on first deploy

See `MODEL_INFO.md` for complete documentation.

### 2. Environment-Aware Configuration

**Changes from main:**
```javascript
// server.js
const PORT = process.env.PORT || 3000;  // Render assigns dynamic port

// Dependencies
const axios = require('axios');  // Proper npm dependency
```

### 3. Deployment Configuration

**New files:**
- `render.yaml` - Automatic Blueprint deployment
- `DEPLOY_RENDER.md` - Complete deployment guide
- `MODEL_INFO.md` - ML model documentation
- `README_LIVE_HOSTING.md` - This file

### 4. Modified `.gitignore`

**Difference:**
```diff
# main branch:
model/              # Ignores all model files

# live-hosting branch:
# model/            # Commented out - model files included!
```

---

## 🚀 Deployment Process

### Quick Deploy (2 clicks)

1. Go to [render.com](https://render.com)
2. New → Blueprint → Select repo → Branch: `live-hosting` → Apply
3. **Done!** Your app will be live in ~5 minutes

### What Happens
```
1. Render clones live-hosting branch
2. Runs: npm install
3. Loads pre-trained model from model/
4. Starts: npm start (web service)
5. Starts: node collector.js (background worker)
6. ✅ Live predictions immediately available!
```

---

## 📊 Expected Behavior After Deploy

### ✅ Immediate Features (No Wait)
- Live alert map works
- ML predictions active (86.8% accuracy)
- Real-time data collection
- Historical analysis
- Favorites system

### 🔄 Auto-Improvement (After First Alert Wave)
1. Collector detects new completed wave
2. Triggers auto-retrain (~15 seconds)
3. New model overwrites pre-trained version
4. Server hot-reloads model
5. Predictions use updated model

**Timeline:**
```
Deploy → Instant predictions → First alert wave → Auto-retrain → Improved model
         (86.8% pre-trained)    (typically 1-6 hrs)  (~15 sec)    (87%+ updated)
```

---

## 🔧 Maintenance

### Updating the Pre-Trained Model

**When to update:**
- Major performance improvement locally
- New features added to model
- Architecture changes
- Significant accuracy gains

**Process:**
```bash
# 1. Switch to main, train new model
git checkout main
npm run train

# 2. Copy model to live-hosting
git checkout live-hosting
git add model/
git commit -m "Update pre-trained model: <describe improvement>"
git push origin live-hosting

# 3. Render auto-deploys with new model
```

### Syncing Other Changes from Main

```bash
# On live-hosting branch
git merge main

# Resolve conflicts if any (usually none)
git push origin live-hosting
```

---

## 📁 File Structure (Deployment-Specific)

```
pikud-live-map/
├── server.js                   # ✏️ Modified (PORT)
├── collector.js                # ✏️ Modified (axios)
├── package.json                # ✏️ Modified (dependencies, scripts)
├── .gitignore                  # ✏️ Modified (allows model/)
├── render.yaml                 # ⭐ NEW - Deploy config
├── DEPLOY_RENDER.md            # ⭐ NEW - Deploy guide
├── MODEL_INFO.md               # ⭐ NEW - Model docs
├── README_LIVE_HOSTING.md      # ⭐ NEW - This file
└── model/                      # ⭐ NEW - Pre-trained model
    ├── model.json
    ├── weights.bin
    ├── normalization.json
    └── metrics.json
```

---

## 🎯 Development Workflow

### Local Development
```bash
# Work on main branch
git checkout main

# Make changes, test locally
npm run serve
npm run collect

# Commit to main
git add .
git commit -m "Feature: your feature"
git push origin main
```

### Deploy to Production
```bash
# Merge main into live-hosting
git checkout live-hosting
git merge main

# Push (triggers auto-deploy)
git push origin live-hosting

# Back to main for more development
git checkout main
```

### Emergency Rollback
```bash
# If deployment breaks
git revert HEAD
git push origin live-hosting

# Or restore old-local backup
git reset --hard origin/old-local
git push origin live-hosting --force
```

---

## ⚠️ Important Notes

### DO NOT modify old-local
The `old-local` branch is your safety backup. Never push changes to it.

### Model Files Are Large-ish
- Total: ~4 KB (tiny for a neural network!)
- Git LFS not needed (files are small)
- Binary files don't compress well in git

### Auto-Deploy on Push
Every push to `live-hosting` triggers Render deployment:
- Build time: ~2-3 minutes
- Downtime: ~10 seconds (rolling deploy)
- Logs available in Render dashboard

### Free Tier Limitations
- Web service sleeps after 15 min inactivity
- Use UptimeRobot to keep awake (see DEPLOY_RENDER.md)
- Background worker runs 24/7

---

## 📞 Troubleshooting

### Model Not Loading
**Check:**
```bash
# Files exist in branch?
git ls-tree live-hosting model/

# Should show:
# model/model.json
# model/weights.bin
# model/normalization.json
# model/metrics.json
```

**Server logs should show:**
```
[ML] Model loaded (alpha=0.70, waves=63, val_acc=86.8%)
```

### Axios Errors
Verify `package.json` has:
```json
"dependencies": {
  "axios": "^1.7.2"
}
```

### Port Binding Errors
Verify `server.js` has:
```javascript
const PORT = process.env.PORT || 3000;
```

---

## 🌐 Live URLs (After Deploy)

- **Web App:** `https://pikud-alert-map.onrender.com`
- **API Status:** `https://pikud-alert-map.onrender.com/api/model-info`
- **Alerts API:** `https://pikud-alert-map.onrender.com/api/alerts`
- **GitHub:** `https://github.com/lirangold6-create/pikud-alert-map/tree/live-hosting`

---

## 🎓 Key Learnings

### Why Separate Branches?
- **main:** Rapid iteration without deployment concerns
- **old-local:** Insurance policy against breaking changes
- **live-hosting:** Production-optimized with pre-trained assets

### Why Include Model in Git?
- Free tier limitations (slow CPU, limited memory)
- Instant functionality on first deploy
- Avoid cold-start training delays
- Known baseline performance

### Why Auto-Retrain?
- Best of both worlds: pre-trained + adaptive
- Learns from production data
- Improves without manual intervention
- No downtime for updates

---

## 📚 Documentation Reference

- **Deployment:** See `DEPLOY_RENDER.md`
- **ML Model:** See `MODEL_INFO.md`
- **Main README:** See `README.md` (general overview)
- **Architecture:** See `ARCHITECTURE.md`
- **Technical Details:** See `TECHNICAL.md`

---

## ✅ Pre-Deployment Checklist

Before deploying this branch:

- [x] Model files present (`ls model/`)
- [x] Model metrics validated (`cat model/metrics.json`)
- [x] PORT uses environment variable
- [x] axios dependency in package.json
- [x] render.yaml configured
- [x] .gitignore allows model files
- [x] Documentation complete
- [x] Tested locally: `npm start`
- [x] All files committed and pushed

---

## 🎉 Success Criteria

After successful deployment, you should see:

1. ✅ App loads at Render URL
2. ✅ Map displays with live alerts
3. ✅ ML predictions shown (probability badges)
4. ✅ API endpoint returns model info
5. ✅ Collector running in background
6. ✅ No errors in logs
7. ✅ Data persisting across requests

---

**Branch Status:** ✅ Ready for Production  
**Model Included:** ✅ Yes (86.8% accuracy)  
**Last Updated:** March 9, 2026  
**Deploy Command:** Push to `live-hosting` (auto-deploys)
