# Cloudflare Worker Setup for Oref API Relay

This worker bypasses the IP blocking issue by relaying Oref API requests through Cloudflare's network.

## Quick Setup (5 minutes)

1. **Go to Cloudflare Workers**: https://workers.cloudflare.com/
2. **Sign up** (free tier - 100,000 requests/day)
3. **Create a new Worker**:
   - Click "Create a Service"
   - Name it: `oref-relay` (or any name)
   - Click "Create Service"
4. **Paste the code**:
   - Click "Quick Edit"
   - Delete all existing code
   - Copy-paste the entire contents of `cloudflare-worker.js`
   - Click "Save and Deploy"
5. **Get your Worker URL**:
   - It will look like: `https://oref-relay.YOUR-USERNAME.workers.dev`
6. **Update Railway environment variable**:
   - Go to your Railway project settings
   - Add environment variable:
     - Name: `OREF_RELAY`
     - Value: `https://oref-relay.YOUR-USERNAME.workers.dev`
   - Save and redeploy

## Test Your Worker

Visit: `https://oref-relay.YOUR-USERNAME.workers.dev/history`

Should return: `[]` or JSON array of alerts (not a 403 error)

## Done!

Your app will now fetch Oref data through the Cloudflare Worker instead of being blocked! 🎉
