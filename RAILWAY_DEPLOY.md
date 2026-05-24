# 🚀 OGFX Deployment Guide - Railway

## Backend Deployment on Railway

### Step 1: Push Code to GitHub

```bash
cd backend-js
git init
git add .
git commit -m "Railway deployment ready"
git branch -M main
git remote add origin https://github.com/yourusername/ogfx-backend.git
git push -u origin main
```

### Step 2: Create Project on Railway

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Connect your GitHub and select `ogfx-backend` repository
5. Railway will auto-detect the `railway.toml` configuration

### Step 3: Add Environment Variables

In Railway Dashboard → Your Project → Variables tab:

```
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
LOG_LEVEL=info
DATABASE_URL=postgresql://postgres.iwvgdaswmxzxgnptgghb:[YOUR_DB_PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres.iwvgdaswmxzxgnptgghb:[YOUR_DB_PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://iwvgdaswmxzxgnptgghb.supabase.co
SUPABASE_KEY=sb_publishable_eDlFrkEY0d9FHiJu6VWfeQ_QGinxII9
JWT_SECRET=your-super-secret-jwt-key-min-32-chars-long
CORS_ORIGIN=*
API_URL=https://ogfx-backend.up.railway.app
WS_URL=wss://ogfx-backend.up.railway.app/ws
BINANCE_API_URL=https://api.binance.com
TWELVEDATA_API_KEY=your_twelvedata_api_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
SIGNAL_INTERVAL_SECONDS=10
MAX_DAILY_SIGNALS=10
MIN_CONFIDENCE=60
```

**Important:** Replace `[YOUR_DB_PASSWORD]` with your actual Supabase database password.

### Step 4: Deploy

Railway will automatically deploy when you push to GitHub or add variables.

Your API will be at: `https://ogfx-backend.up.railway.app`

### Step 5: Verify Deployment

Test endpoints:
- Health: `https://ogfx-backend.up.railway.app/health`
- API Docs: `https://ogfx-backend.up.railway.app/docs`

---

## Frontend Deployment on Vercel

### Step 1: Update Frontend .env.local

Update `frontend/.env.local` with Railway backend URL:

```env
NEXT_PUBLIC_API_URL=https://ogfx-backend.up.railway.app
NEXT_PUBLIC_SUPABASE_URL=https://iwvgdaswmxzxgnptgghb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_eDlFrkEY0d9FHiJu6VWfeQ_QGinxII9
```

### Step 2: Push Frontend Code

```bash
cd frontend
git init
git add .
git commit -m "Initial frontend commit"
git branch -M main
git remote add origin https://github.com/yourusername/ogfx-frontend.git
git push -u origin main
```

### Step 3: Deploy to Vercel

1. Go to [Vercel](https://vercel.com)
2. Import GitHub repository
3. Configure:
   - **Framework:** Next.js
   - **Build Command:** `npm run build`
   - **Output Directory:** `.next`

4. Add Environment Variables (same as .env.local above)

5. Click **Deploy**

---

## Telegram Bot Setup

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Create new bot: `/newbot`
3. Copy the bot token
4. Add to Railway Variables: `TELEGRAM_BOT_TOKEN=your_token`
5. Set webhook after deployment:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://ogfx-backend.up.railway.app/webhook
```

---

## Railway Pricing

| Plan | Price | Features |
|------|-------|----------|
| **Starter** | **$5/mo** | **500 hours, 1GB RAM, WebSockets** |
| Pro | $35/mo | Unlimited hours, more resources |

**Starter plan is enough for OGFX backend!**

---

## Files for Railway

### railway.toml (in backend-js/)
```toml
[build]
builder = "nixpacks"
buildCommand = "npm install && npx prisma generate"

[deploy]
startCommand = "npm start"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10
healthcheckPath = "/health"
healthcheckTimeout = 100
```

### nixpacks.toml (in backend-js/)
```toml
[phases.build]
cmds = [
    "npm install",
    "npx prisma generate"
]

[phases.setup]
nixPkgs = ["nodejs_20", "npm"]

[start]
cmd = "npm start"
```

---

## Post-Deployment Checklist

- [ ] Backend health check passes (`/health`)
- [ ] Database connected (check Railway logs)
- [ ] Frontend loads without errors
- [ ] API calls work (test signup at `/users/register`)
- [ ] Telegram bot responds
- [ ] Signals are generated
- [ ] CORS configured for frontend domain

---

## Troubleshooting

### Database Connection Issues
```
Error: Can't reach database server
```
- Check DATABASE_URL format in Railway variables
- Ensure Supabase password is correct (no brackets)
- Verify Supabase project is active

### CORS Errors
```
Access-Control-Allow-Origin header missing
```
- Update `CORS_ORIGIN` in Railway with your Vercel frontend URL
- Example: `CORS_ORIGIN=https://ogfx-frontend.vercel.app`

### WebSocket Issues
```
WebSocket connection failed
```
- Use `wss://` not `ws://` for production
- Check `WS_URL` variable: `wss://ogfx-backend.up.railway.app/ws`

### Build Failures
```
npm ERR! missing script: build
```
- Verify `package.json` has `"build": "npm install && npx prisma generate"`
- Check `railway.toml` buildCommand is set

### Prisma Errors
```
Error: @prisma/client did not initialize yet
```
- Ensure `npx prisma generate` runs during build
- Check that `railway.toml` has correct buildCommand

---

## Custom Domain (Optional)

1. In Railway Dashboard → Settings → Domains
2. Click "Generate Domain" for free `.up.railway.app` URL
3. Or add custom domain with your own DNS

---

## Railway CLI (Optional)

Install Railway CLI for local development:
```bash
npm install -g @railway/cli
railway login
railway link
railway variables
```

Deploy from CLI:
```bash
railway up
```

---

**Ready to deploy!** 🚀 Push to GitHub and Railway will auto-deploy.
