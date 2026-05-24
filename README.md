# OGFX - Premium Trading Signals Platform

A production-ready trading signals platform with rule-based strategy engine, real-time WebSocket updates, and Telegram bot integration.

## 🏗 Architecture

```
ogfx/
├── frontend/           # Next.js 14 + Tailwind + ShadCN
├── backend-js/        # Node.js + Fastify
├── engine/            # Strategy Engine (Rule + Context)
├── bot/               # Telegram Bot
├── strategies/        # Strategy JSON files
└── docs/              # Documentation
```

## ✨ Features

### Frontend
- Dark theme trading dashboard (#0B0F19)
- TradingView Advanced Chart integration
- Real-time signals panel with glassmorphism UI
- Phone + OTP authentication
- Mobile responsive design
- Framer Motion animations

### Backend
- Fastify REST API
- WebSocket for live signal broadcasting
- JWT authentication
- PostgreSQL database with Prisma ORM
- Scheduled signal generation (every 10s)

### Strategy Engine
- **Rule Engine**: Breakout, RSI, EMA trend, price action
- **Context Engine**: Session filters, volatility check, volume confirmation
- **Signal Engine**: Combines both with confidence scoring
- Risk management with configurable SL/TP multipliers

### Telegram Bot
- `/start` - Welcome message
- `/signals` - View latest signals
- `/subscribe` - Subscribe to alerts
- `/unsubscribe` - Stop notifications
- `/status` - Check subscription status
- `/help` - Show commands

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Telegram bot token (optional)

### Backend Setup

```bash
cd backend-js

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your database URL and secrets

# Database setup
npx prisma generate
npx prisma db push

# Start server
npm run dev
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

### Telegram Bot Setup

```bash
# In backend-js/.env
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather

# Bot will auto-start with backend
```

## 📊 Strategy Configuration

Edit `strategies/default.json` to customize rules:

```json
{
  "rules": {
    "BUY": {
      "breakout": { "enabled": true, "lookback": 20, "threshold": 0.95 },
      "rsi": { "enabled": true, "period": 14, "oversold": 35, "overbought": 70 },
      "trend": { "enabled": true, "fastEma": 20, "slowEma": 50 },
      "priceAction": { "enabled": true, "minBars": 5, "pattern": "higherLows" }
    }
  },
  "context": {
    "minConfidence": 60,
    "trendAlignment": { "enabled": true, "bonus": 20 },
    "session": { "enabled": true, "bonus": 10 }
  }
}
```

## 🌐 API Endpoints

### Signals
- `GET /signals` - List all signals
- `GET /signals/active` - Active signals only
- `GET /signals/stats` - Signal statistics
- `GET /signals/:id` - Get single signal

### Analysis
- `POST /analyze` - Manual symbol analysis
- `POST /analyze/all` - Analyze all symbols
- `GET /analyze/strategy` - Get strategy config

### Auth
- `POST /auth/send-otp` - Send OTP to phone
- `POST /auth/verify-otp` - Verify OTP and login
- `GET /auth/verify` - Verify JWT token

### WebSocket
- `ws://localhost:3001/ws` - Real-time signal feed

## 🚢 Deployment

### Railway (Backend + Database)

1. Create new project on Railway
2. Add PostgreSQL database
3. Deploy from GitHub repo
4. Set environment variables in Railway dashboard

```bash
# Environment variables for Railway
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=your-secret-key
TELEGRAM_BOT_TOKEN=your-bot-token
```

### Vercel (Frontend)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Or connect GitHub repo to Vercel for auto-deploys.

## 📁 Project Structure

```
ogfx/
├── frontend/
│   ├── app/
│   │   ├── (home)/page.tsx      # Home with TradingView
│   │   ├── dashboard/page.tsx   # Signals dashboard
│   │   ├── auth/page.tsx        # Phone OTP login
│   │   └── layout.tsx           # Root layout
│   ├── components/
│   │   ├── ui/                  # ShadCN components
│   │   └── trading/             # Trading components
│   ├── hooks/
│   │   ├── useWebSocket.ts      # WebSocket hook
│   │   └── useSignals.ts        # Signals data hook
│   └── lib/
│       └── utils.ts             # Tailwind utils
│
├── backend-js/
│   ├── src/
│   │   ├── index.js             # Server entry
│   │   ├── routes/              # API routes
│   │   ├── services/            # Business logic
│   │   ├── engine/              # Strategy engines
│   │   └── ws/                  # WebSocket handler
│   ├── prisma/
│   │   └── schema.prisma        # Database schema
│   └── .env.example
│
├── engine/
│   └── pdfParser.js             # PDF strategy parser
│
├── bot/
│   └── index.js                 # Telegram bot
│
└── strategies/
    └── default.json             # Strategy configuration
```

## 🔐 Environment Variables

### Backend
```env
PORT=3001
DATABASE_URL="postgresql://..."
JWT_SECRET="your-secret"
TELEGRAM_BOT_TOKEN="your-bot-token"
CORS_ORIGIN="*"
```

### Frontend
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
```

## 📝 License

MIT License - See LICENSE file

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## ⚠️ Disclaimer

This platform is for educational purposes. Trading involves significant risk. Always do your own research and consider your financial situation before trading.
