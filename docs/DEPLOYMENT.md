# OGFX Deployment Guide

Complete guide for deploying OGFX to production.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Railway Deployment (Backend)](#railway-deployment-backend)
3. [Vercel Deployment (Frontend)](#vercel-deployment-frontend)
4. [Telegram Bot Setup](#telegram-bot-setup)
5. [Database Setup](#database-setup)
6. [Environment Variables](#environment-variables)
7. [Post-Deployment Verification](#post-deployment-verification)

---

## Prerequisites

- Railway account (railway.app)
- Vercel account (vercel.com)
- GitHub repository with OGFX code
- Telegram account (for bot)

---

## Railway Deployment (Backend)

### Step 1: Create Railway Project

1. Log in to [Railway](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your OGFX repository

### Step 2: Add PostgreSQL Database

1. In your Railway project, click "New"
2. Select "Database" → "Add PostgreSQL"
3. Railway will automatically add the `DATABASE_URL` to your environment

### Step 3: Configure Service

1. Select your backend service
2. Go to "Settings" tab
3. Set Root Directory: `backend-js`
4. Build Command: `npm install && npx prisma generate`
5. Start Command: `npm start`

### Step 4: Environment Variables

Add these variables in Railway Dashboard → Variables:

```
PORT=3001
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info
JWT_SECRET=<generate-random-secret>
CORS_ORIGIN=https://your-frontend-domain.vercel.app
TELEGRAM_BOT_TOKEN=<your-bot-token>
SIGNAL_INTERVAL_SECONDS=10
```

Generate a secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Step 5: Deploy

1. Railway will auto-deploy on git push
2. Monitor logs in Railway Dashboard
3. Verify health check: `https://your-app.railway.app/health`

---

## Vercel Deployment (Frontend)

### Step 1: Connect Repository

1. Go to [Vercel](https://vercel.com)
2. Click "Add New Project"
3. Import your GitHub repository
4. Select the `frontend` directory as Root Directory

### Step 2: Configure Build Settings

Framework Preset: Next.js

Build Command: `npm run build`
Output Directory: `.next`

### Step 3: Environment Variables

Add these in Vercel Dashboard → Settings → Environment Variables:

```
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
NEXT_PUBLIC_WS_URL=wss://your-backend.railway.app/ws
```

### Step 4: Deploy

1. Click "Deploy"
2. Vercel will build and deploy automatically
3. Domain will be provided (e.g., `ogfx.vercel.app`)

### Step 5: Update CORS

Go back to Railway and update CORS_ORIGIN:

```
CORS_ORIGIN=https://ogfx.vercel.app
```

Redeploy backend service.

---

## Telegram Bot Setup

### Step 1: Create Bot

1. Open Telegram and search for @BotFather
2. Send `/newbot`
3. Follow prompts to name your bot
4. Save the bot token provided

### Step 2: Add Token to Railway

1. Go to Railway Dashboard → Variables
2. Add: `TELEGRAM_BOT_TOKEN=your-token-here`
3. Redeploy the service

### Step 3: Set Webhook (Optional)

For production with webhooks:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -d "url=https://your-backend.railway.app/bot/webhook"
```

---

## Database Setup

### Run Migrations

After first deployment, run migrations:

1. Go to Railway Dashboard
2. Click on your service
3. Go to "Deploy" tab
4. Click "New" → "Command"
5. Run: `npx prisma db push`

### Verify Connection

Check database connection via health endpoint:

```bash
curl https://your-backend.railway.app/health
```

---

## Environment Variables Summary

### Backend (.env)

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3001) |
| `DATABASE_URL` | PostgreSQL connection | Yes |
| `JWT_SECRET` | JWT signing key | Yes |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | No |
| `CORS_ORIGIN` | Frontend URL | Yes |
| `LOG_LEVEL` | Logging level | No (default: info) |

### Frontend (.env.local)

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | Yes |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL | Yes |

---

## Post-Deployment Verification

### 1. Health Check

```bash
curl https://your-backend.railway.app/health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "1.0.0"
}
```

### 2. API Test

```bash
curl https://your-backend.railway.app/signals
```

### 3. WebSocket Test

Use browser DevTools console:
```javascript
const ws = new WebSocket('wss://your-backend.railway.app/ws');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

### 4. Frontend Check

1. Visit your Vercel URL
2. Verify TradingView chart loads
3. Check WebSocket connection status (green "LIVE" badge)

### 5. Telegram Bot Test

1. Open Telegram
2. Find your bot
3. Send `/start`
4. Send `/signals`

---

## Troubleshooting

### Backend won't start

- Check DATABASE_URL is correct
- Verify PORT is set to 3001
- Check logs in Railway Dashboard

### Frontend can't connect to backend

- Verify CORS_ORIGIN matches Vercel domain exactly
- Check NEXT_PUBLIC_API_URL uses HTTPS
- Ensure WebSocket URL uses WSS (secure)

### Telegram bot not responding

- Verify TELEGRAM_BOT_TOKEN is correct
- Check bot hasn't been blocked
- Look for errors in Railway logs

### No signals generating

- Check SIGNAL_INTERVAL_SECONDS is set
- Verify strategy configuration is valid
- Look at engine logs for analysis results

---

## 🎉 Success!

Your OGFX platform should now be live with:
- Frontend: https://your-app.vercel.app
- Backend: https://your-app.railway.app
- API Docs: https://your-app.railway.app/docs
