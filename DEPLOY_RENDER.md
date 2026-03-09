# Deploying to Render.com

This guide will help you deploy the Pikud Alert Map to Render.com's free tier.

## 🚀 Quick Deploy (Automatic)

### Option 1: Using render.yaml (Recommended)

1. **Sign up** at [render.com](https://render.com) (free account)

2. **Connect GitHub**:
   - Click "New +" → "Blueprint"
   - Select your `pikud-alert-map` repository
   - Branch: `live-hosting`
   - Render will auto-detect `render.yaml`

3. **Deploy**:
   - Click "Apply"
   - Wait 5-10 minutes for initial deployment
   - Your app will be live at: `https://pikud-alert-map.onrender.com`

### Option 2: Manual Setup

#### A. Deploy Web Service (HTTP Server)

1. Click "New +" → "Web Service"
2. Connect your GitHub repository
3. Configure:
   - **Name:** `pikud-alert-map`
   - **Region:** Frankfurt (or closest to Israel)
   - **Branch:** `live-hosting`
   - **Root Directory:** (leave empty)
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free

4. **Add Persistent Disk** (Important!):
   - Go to service settings → "Disks"
   - Add disk:
     - **Name:** `pikud-data`
     - **Mount Path:** `/opt/render/project/src/data`
     - **Size:** 1 GB (free tier)

5. **Environment Variables** (optional):
   - Add `NODE_ENV` = `production`

6. Click "Create Web Service"

#### B. Deploy Background Worker (Data Collector)

1. Click "New +" → "Background Worker"
2. Connect same repository
3. Configure:
   - **Name:** `pikud-collector`
   - **Region:** Frankfurt
   - **Branch:** `live-hosting`
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node collector.js`
   - **Instance Type:** Free

4. **Add Persistent Disk**:
   - **Name:** `pikud-collector-data`
   - **Mount Path:** `/opt/render/project/src/data`
   - **Size:** 1 GB

5. Click "Create Background Worker"

---

## ⚠️ Free Tier Limitations

### Web Service:
- **Sleeps after 15 minutes** of inactivity
- **Wakes up** automatically when someone visits (takes ~30 seconds)
- **750 hours/month** (enough for 24/7 if you keep it awake)

### Keep-Alive Solution:
Use [UptimeRobot](https://uptimerobot.com) (free) to ping your site every 5 minutes:
1. Sign up at uptimerobot.com
2. Add new monitor:
   - Type: HTTP(s)
   - URL: `https://pikud-alert-map.onrender.com`
   - Monitoring Interval: 5 minutes
3. Your app will never sleep!

### Background Worker:
- Runs continuously (doesn't sleep)
- Uses separate 750 hours/month quota

---

## 📊 What Gets Deployed

### Included:
- ✅ Server (server.js)
- ✅ Collector (collector.js)
- ✅ Frontend (index.html)
- ✅ Dependencies (installed via npm)
- ✅ Static city data (pikud-haoref-api/)

### Generated on Server:
- 📦 collected-alerts.json (created by collector)
- 📦 collected-waves.json (created by collector)
- 📦 model/ directory (created by training)
- 📦 *.log files

---

## 🔧 Post-Deployment

### Check Logs:
- **Web Service:** Render Dashboard → Your service → "Logs"
- **Collector:** Render Dashboard → Collector service → "Logs"

### Expected Logs:

**Server:**
```
[ML] No trained model found (normal on first run)
Live alert map running at http://0.0.0.0:10000
```

**Collector:**
```
Alert collector started (oref + tzevaadom)
  Oref alerts: 0
  Waves: 0
  Polling every 30s
```

### First Training:
The ML model will train automatically after the first completed alert wave (with ≥5 cities and green "event ended" alerts).

---

## 🌐 Custom Domain (Optional)

1. In Render Dashboard → Your service → "Settings"
2. Scroll to "Custom Domain"
3. Add your domain (e.g., `alerts.yourdomain.com`)
4. Update DNS records as instructed
5. SSL certificate auto-provisioned (free)

---

## 🐛 Troubleshooting

### Service Won't Start:
- Check logs for errors
- Verify `npm install` completed successfully
- Ensure all dependencies in package.json

### Data Not Persisting:
- Verify persistent disk is mounted at `/opt/render/project/src/data`
- Check disk usage in Render dashboard

### ML Model Not Loading:
- **Normal on first deployment** (no model exists yet)
- Model generates after first completed alert wave
- Check collector logs for "[retrain] Triggering retrain..."

### Collector Not Running:
- Ensure background worker is deployed separately
- Check worker logs for errors
- Verify it's on "Free" plan (not disabled)

### App Keeps Sleeping:
- Set up UptimeRobot pinging (see above)
- Verify you're on Free plan (not Starter which has different rules)

---

## 💰 Cost

**Total: $0/month** (Free tier)

Both services run on Render's free tier:
- Web Service: Free (750 hours/month)
- Background Worker: Free (750 hours/month)
- Persistent Disk: Free (1GB per service)
- SSL Certificate: Free
- Bandwidth: 100GB/month free

---

## 🔄 Updating Your App

Render auto-deploys when you push to the `live-hosting` branch:

```bash
# Make changes locally
git add .
git commit -m "Your update message"
git push origin live-hosting

# Render automatically rebuilds and redeploys (takes ~2-3 minutes)
```

---

## 📞 Support

- **Render Status:** [status.render.com](https://status.render.com)
- **Render Docs:** [render.com/docs](https://render.com/docs)
- **Community:** [community.render.com](https://community.render.com)

---

## 🎯 Next Steps After Deployment

1. ✅ Test your live URL
2. ✅ Set up UptimeRobot keep-alive
3. ✅ Monitor logs for first few hours
4. ✅ Wait for first alert wave to train ML model
5. ✅ Share your live map! 🎉

---

**Your live map will be at:** `https://pikud-alert-map.onrender.com`

(Exact URL shown in Render dashboard after deployment)
