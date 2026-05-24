# OGFX Trading Platform Backend

Real-time trading signals platform backend built with Node.js, Fastify, and Prisma.

## 🚀 Features

- **Signal Engine**: Advanced SMC (Smart Money Concepts) + Elite signal generation
- **WebSocket**: Real-time signal streaming
- **REST API**: Complete trading API with Swagger docs
- **Telegram Bot**: Automated signal broadcasting
- **Supabase**: PostgreSQL database with Prisma ORM

## 📦 Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Fastify 4.x
- **Database**: PostgreSQL (Supabase)
- **ORM**: Prisma 5.x
- **WebSocket**: @fastify/websocket
- **Auth**: JWT (@fastify/jwt)
- **Bot**: Telegraf

## 🛠️ Development

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run dev server
npm run dev
```

## 🚀 Deployment

### Railway (Recommended)

1. Push to GitHub
2. Connect repo to Railway
3. Add environment variables
4. Auto-deploys on every push

### Environment Variables

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_KEY=...
JWT_SECRET=...
TELEGRAM_BOT_TOKEN=...
```

## 📡 API Endpoints

- `GET /health` - Health check
- `GET /docs` - Swagger documentation
- `POST /users/register` - User registration
- `GET /analyze/:symbol` - Signal analysis
- `WS /ws` - WebSocket for real-time signals

## 📄 License

MIT License - OGFX Trading Platform
