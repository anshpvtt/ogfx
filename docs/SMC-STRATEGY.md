# OGFX Smart Money Concepts (SMC) Trading Strategy

## 📚 Overview

The OGFX SMC (Smart Money Concepts) engine is an institutional-grade trading system based on how large financial institutions ("smart money") actually move the markets. Unlike traditional indicator-based strategies, SMC focuses on **liquidity**, **market structure**, and **order flow**.

### Core Philosophy

> "Trade the reaction after liquidity sweep, not the breakout"

**Key Principle:** Market moves because of liquidity (not indicators). Institutions collect liquidity (stop losses), then move price in their intended direction.

---

## 🧠 Architecture

The SMC engine consists of 8 specialized components:

### 1. Market Structure Engine
Detects Higher Highs (HH), Higher Lows (HL), Lower Highs (LH), Lower Lows (LL)

```javascript
Bullish: HH + HL
Bearish: LH + LL
Ranging: Equal highs + equal lows
```

**Features:**
- Swing high/low detection using pivot points
- Break of Structure (BOS) detection
- Market Structure Shift (MSS/CHoCH) identification
- Trend bias calculation

### 2. Liquidity Engine
Identifies where stop losses are clustered:

**Buy-Side Liquidity:**
- Equal highs (resistance levels)
- Previous swing highs

**Sell-Side Liquidity:**
- Equal lows (support levels)
- Previous swing lows

**Strength Calculation:**
```javascript
Liquidity Strength = Touches × Volume Factor
```

### 3. Liquidity Sweep Detector
Detects institutional manipulation:

**Valid BUY Setup:**
1. Price goes below equal lows
2. Creates wick (30%+ of candle)
3. Closes back above the level

**Valid SELL Setup:**
1. Price goes above equal highs
2. Creates wick (30%+ of candle)
3. Closes back below the level

**Parameters:**
- Wick threshold: 30%
- Min sweep distance: 0.05%
- Close confirmation required

### 4. Confirmation Engine
Validates setups after sweep detection:

**Confirmation Patterns:**
| Pattern | Bullish | Bearish | Weight |
|---------|---------|---------|--------|
| Engulfing | Bull engulfs bear | Bear engulfs bull | 20% |
| BOS | Breaks above high | Breaks below low | 20% |
| MSS/CHoCH | LL → HH break | HH → LL break | 25% |
| Displacement | +0.3% move | -0.3% move | 15% |
| Pin Bar | Lower rejection | Upper rejection | 20% |

### 5. HTF Alignment Engine
Higher Time Frame (1H) directional bias:

**Rules:**
- HTF Bullish → Only take BUY signals
- HTF Bearish → Only take SELL signals
- Score ≥ 60 required

**Bonus:** +30 points for full HTF alignment

### 6. Supply/Demand Zone Detector
Identifies institutional order blocks:

**Demand Zone:** Rally → Base → Rally
**Supply Zone:** Drop → Base → Drop

**Quality Factors:**
- Strong departure (2x ATR)
- Small base (≤5 candles)
- Fresh (untested)

### 7. Context Filter
Rejects low-quality setups:

| Filter | Criteria | Penalty |
|--------|----------|---------|
| Session | London/NY preferred | -15 if off-hours |
| Volatility | 0.1% < ATR < 2.0% | -20 if outside |
| HTF | Score ≥ 60 | -30 if low |
| Spread | < 0.05% | -10 if high |
| Cooldown | 30 min between signals | Block if active |

### 8. Signal Engine
Combines all components with confidence scoring:

**Confidence Weights:**
```
Sweep Quality:     30 points
Confirmation:      20 points
HTF Alignment:     20 points
Zone Quality:      15 points
Context Filter:    10 points
Structure Align:    5 points
```

**Thresholds:**
- ≥85%: High Quality (Diamond 💎)
- ≥70%: Tradeable (Star ✨)
- <70%: Reject

---

## 🎯 Entry Models

### 1. Sniper Entry
- Enter when price is inside zone
- Highest R:R but riskiest
- Requires strong sweep confirmation

### 2. Confirmation Entry
- Wait for confirmation after sweep
- Safest entry method
- Best for standard SMC setups

### 3. Refined Entry
- Lower TF zone inside HTF zone
- Best R:R with confluence
- Multiple timeframe alignment

---

## 📊 Risk Management

### Stop Loss Placement
- Place at sweep extreme (wick low/high)
- Add 0.05% buffer
- Never exceed 2% account risk

### Take Profit
- Target next liquidity pool
- Minimum 1.5:1 R:R
- Target 2.0:1 R:R

### Position Sizing
```
Risk per trade: 1-2% of account
Max daily risk: 5% of account
Breakeven trigger: 1:1 R:R reached
```

---

## 🚫 Absolute Rules

1. **NEVER** trade without sweep
2. **NEVER** trade without confirmation
3. **ALWAYS** follow HTF bias
4. **DO NOT** trade in low volatility (Asian session)
5. **DO NOT** trade against HTF structure
6. **ALWAYS** use stop loss
7. **NEVER** risk more than 2% per trade

---

## 📈 Performance Targets

| Metric | Target |
|--------|--------|
| Win Rate | 70%+ |
| Min R:R | 1.5:1 |
| Target R:R | 2.0:1 |
| Max Daily Signals | 5 per pair |
| Review Period | Weekly |

---

## 🔌 API Endpoints

### Get SMC Analysis
```http
GET /analyze/smc/:symbol
```

**Response:**
```json
{
  "success": true,
  "symbol": "XAUUSD",
  "analysis": {
    "structure": {
      "trend": "bullish",
      "swings": [...],
      "breaks": [...]
    },
    "liquidity": {
      "buySide": [...],
      "sellSide": [...]
    },
    "sweep": {
      "sweepBelow": true,
      "sweeps": [...]
    },
    "zones": {
      "demandZones": [...],
      "supplyZones": [...]
    }
  }
}
```

### Get Strategy Config
```http
GET /analyze/strategy
```

**Response:**
```json
{
  "strategy": {
    "primary": { /* SMC config */ },
    "fallback": { /* Rule-based config */ }
  },
  "smc": { /* SMC parameters */ },
  "isRunning": true
}
```

---

## 🔄 Real-Time Flow

```
Every 5 seconds:
    ↓
Fetch market data
    ↓
Detect market structure
    ↓
Identify liquidity pools
    ↓
Detect sweeps
    ↓
Check confirmation
    ↓
Apply context filters
    ↓
Generate signal
    ↓
Send to:
    ├─ WebSocket (frontend)
    └─ Telegram bot
```

---

## 🎨 Telegram Signal Format

```
💎 🟢 OGFX SMC SIGNAL

PAIR: XAUUSD
TYPE: 📈 BUY
ENTRY: 2350.50
SL: 2342.30
TP: 2366.80

Confidence: 92%
R:R: 2.1:1

Reason:
Sell-side liquidity sweep + bullish BOS + HTF alignment

📊 SMC Analysis:
• HTF: 🐂 BULLISH
• Structure: uptrend
• Sweep: ✅ Sell-side sweep
• Zone: demand (Q:85)

🎯 HTF Score: 78%
⏰ 4/10/2026, 12:30:45 PM
```

---

## 🛠 Configuration

Edit `strategies/smc.json` to customize:

```json
{
  "sweepDetection": {
    "wickThreshold": 0.3,
    "minSweepDistance": 0.0005
  },
  "confirmation": {
    "requireConfirmation": true,
    "minConfidence": 60
  },
  "htfAlignment": {
    "minScore": 60
  },
  "riskManagement": {
    "targetRR": 2.0
  }
}
```

---

## 🧪 Testing

Run SMC analysis on a symbol:
```bash
curl http://localhost:3001/analyze/smc/XAUUSD
```

Manual trigger:
```bash
curl -X POST http://localhost:3001/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbol": "EURUSD"}'
```

---

## 📚 Further Reading

- **ICT (Inner Circle Trader)** methodology
- **Order Block Theory**
- **Fair Value Gaps**
- **Breaker Blocks**
- **Mitigation Blocks**

---

## ⚠️ Disclaimer

SMC trading requires significant practice and understanding. This system is for educational purposes. Always test on demo accounts before trading live capital. Trading involves substantial risk of loss.

---

**Built with 💙 by OGFX Team**
