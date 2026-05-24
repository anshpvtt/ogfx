# 🚀 OGFX Deployment Guide

## Backend Deployment on Render

### Step 1: Push Code to GitHub

```bash
cd backend-js
git init
git add .
git commit -m "Initial backend commit"
git branch -M main
git remote add origin https://github.com/yourusername/ogfx-backend.git
git push -u origin main
```

### Step 2: Create Web Service on Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name:** `ogfx-backend`
   - **Runtime:** Node
   - **Build Command:** `npm install && npx prisma generate`
   - **Start Command:** `npm start`
   - **Plan:** Standard ($7/month) - required for WebSockets

### Step 3: Add Environment Variables

In Render Dashboard → ogfx-backend → Environment:

```
NODE_ENV=production
PORT=10000
HOST=0.0.0.0
LOG_LEVEL=info
DATABASE_URL=postgresql://postgres.iwvgdaswmxzxgnptgghb:[YOUR_DB_PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres.iwvgdaswmxzxgnptgghb:[YOUR_DB_PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://iwvgdaswmxzxgnptgghb.supabase.co
SUPABASE_KEY=sb_publishable_eDlFrkEY0d9FHiJu6VWfeQ_QGinxII9
JWT_SECRET=your-super-secret-jwt-key-min-32-chars-long
CORS_ORIGIN=*
API_URL=https://ogfx-backend.onrender.com
WS_URL=wss://ogfx-backend.onrender.com/ws
BINANCE_API_URL=https://api.binance.com
TWELVEDATA_API_KEY=your_twelvedata_api_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
SIGNAL_INTERVAL_SECONDS=10
MAX_DAILY_SIGNALS=10
MIN_CONFIDENCE=60
```

### Step 4: Deploy

Click **"Create Web Service"** and wait for deployment.

Your API will be at: `https://ogfx-backend.onrender.com`

### Step 5: Verify Deployment

Test endpoints:
- Health: `https://ogfx-backend.onrender.com/health`
- API Docs: `https://ogfx-backend.onrender.com/docs`

---

## Frontend Deployment on Vercel

### Step 1: Push Frontend Code

```bash
cd frontend
git init
git add .
git commit -m "Initial frontend commit"
git branch -M main
git remote add origin https://github.com/yourusername/ogfx-frontend.git
git push -u origin main
```

### Step 2: Deploy to Vercel

1. Go to [Vercel](https://vercel.com)
2. Import GitHub repository
3. Configure:
   - **Framework:** Next.js
   - **Build Command:** `npm run build`
   - **Output Directory:** `.next`

4. Add Environment Variables:
```
NEXT_PUBLIC_API_URL=https://ogfx-backend.onrender.com
NEXT_PUBLIC_SUPABASE_URL=https://iwvgdaswmxzxgnptgghb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_eDlFrkEY0d9FHiJu6VWfeQ_QGinxII9
```

5. Click **Deploy**

---

## Telegram Bot Setup

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Create new bot: `/newbot`
3. Copy the bot token
4. Add to Render env vars: `TELEGRAM_BOT_TOKEN=your_token`
5. Set webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://ogfx-backend.onrender.com/webhook`

---

## Post-Deployment Checklist

- [ ] Backend health check passes
- [ ] Database connected (check logs)
- [ ] Frontend loads without errors
- [ ] API calls work (test signup)
- [ ] Telegram bot responds
- [ ] Signals are generated
- [ ] Update frontend .env with production API URL

---

## Troubleshooting

### Database Connection Issues
```
Error: Can't reach database server
```
- Check DATABASE_URL format
- Ensure Supabase password is correct
- Verify Supabase project is active

### CORS Errors
```
Access-Control-Allow-Origin header missing
```
- Update CORS_ORIGIN in backend with frontend URL
- Or keep as `*` for development

### WebSocket Issues
```
WebSocket connection failed
```
- Use `wss://` not `ws://` for production
- Render Standard plan required for WebSockets

### Build Failures
```
npm ERR! missing script: build
```
- Check package.json has correct scripts
- Ensure all dependencies are in dependencies (not devDependencies)
