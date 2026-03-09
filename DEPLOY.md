# Deploy to Render (Free)

## Quick Deploy
1. Go to [render.com](https://render.com) → Sign up (free)
2. Click **New +** → **Blueprint**
3. Repository: `pikud-alert-map` | Branch: `live-hosting`
4. Click **Apply**
5. Wait ~5-10 min → Live at `https://pikud-alert-map.onrender.com`

## What You Get
- ✅ Live alert map with ML predictions (86.8% accuracy)
- ✅ Real-time data collection
- ✅ Auto-retrain capability
- ✅ Cost: $0/month

## Keep Alive (Optional)
Free tier sleeps after 15 min inactivity. Use [UptimeRobot](https://uptimerobot.com) to ping every 5 min.

## Update App
```bash
git checkout live-hosting
git merge main
git push origin live-hosting
# Auto-deploys in 2-3 min
```
