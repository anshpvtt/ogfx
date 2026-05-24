import { logger } from "../services/logger.js";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function computePnL(type, entry, exit) {
  const dir = type === "BUY" ? 1 : -1;
  return (exit - entry) * dir;
}

function simulateForward({ candles, entryIndex, type, entry, sl, tp }) {
  for (let i = entryIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    const slHit = type === "BUY" ? c.low <= sl : c.high >= sl;
    const tpHit = type === "BUY" ? c.high >= tp : c.low <= tp;

    // Conservative ordering on same candle: assume SL first
    if (slHit && tpHit) return { exitIndex: i, result: "LOSS", exit: sl };
    if (slHit) return { exitIndex: i, result: "LOSS", exit: sl };
    if (tpHit) return { exitIndex: i, result: "WIN", exit: tp };
  }
  // If neither hit, close at last close
  const last = candles[candles.length - 1];
  return { exitIndex: candles.length - 1, result: "TIMEOUT", exit: last.close };
}

function calcDrawdown(equityCurve) {
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.equity);
    if (peak > 0) {
      const dd = (peak - p.equity) / peak;
      maxDd = Math.max(maxDd, dd);
    }
  }
  return maxDd;
}

export function calcMetrics(trades, equityCurve) {
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.result === "WIN").length;
  const losses = trades.filter((t) => t.result === "LOSS").length;
  const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;

  const grossProfit = trades
    .filter((t) => t.pnl > 0)
    .reduce((s, t) => s + t.pnl, 0);
  const grossLossAbs = Math.abs(
    trades
      .filter((t) => t.pnl < 0)
      .reduce((s, t) => s + t.pnl, 0)
  );
  const profitFactor = grossLossAbs === 0 ? (grossProfit > 0 ? 999 : 0) : grossProfit / grossLossAbs;

  const rrs = trades.map((t) => t.rr).filter((x) => Number.isFinite(x));
  const averageRR = rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : 0;

  const maxDrawdown = calcDrawdown(equityCurve) * 100;

  return {
    totalTrades,
    wins,
    losses,
    winRate: parseFloat(winRate.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    averageRR: parseFloat(averageRR.toFixed(2)),
  };
}

export async function backtestEngine({
  symbol,
  timeframe,
  candles,
  eliteEngine,
  strategy = "ELITE",
  playbookResolver,
  initialBalance = 1000,
  minConfidence = 85,
  warmupBars = 120,
  maxTrades = 500,
  cooldownBars = 10,
}) {
  let balance = safeNum(initialBalance, 1000);
  const equityCurve = [{ index: 0, equity: balance }];
  const trades = [];

  let cooldown = 0;

  for (let i = warmupBars; i < candles.length - 2; i++) {
    if (trades.length >= maxTrades) break;
    if (cooldown > 0) {
      cooldown -= 1;
      continue;
    }

    const window = candles.slice(0, i + 1);
    const last = window[window.length - 1];

    let s = null;

    if (strategy === "LSBR" && typeof playbookResolver === "function") {
      const playbook = playbookResolver({ symbol, candles: window });
      s = playbook?.signal || null;
    } else {
      // Strict ELITE rule-based decision maker (deterministic)
      let eliteResult;
      try {
        eliteResult = eliteEngine.analyze(symbol, {
          candles: window,
          close: last.close,
          indicators: last.indicators,
          levels: last.levels,
        });
      } catch (e) {
        logger.warn(`ELITE analyze error at bar ${i}: ${e?.message || e}`);
        continue;
      }

      if (!eliteResult?.valid || !eliteResult?.signal) continue;
      s = eliteResult.signal;
    }

    if (!s.type || (s.type !== "BUY" && s.type !== "SELL")) continue;
    if (safeNum(s.confidence, 0) < minConfidence) continue;

    const entry = safeNum(s.entry, last.close);
    const sl = safeNum(s.stopLoss, 0);
    const tp = safeNum(s.takeProfit, 0);
    if (!sl || !tp) continue;

    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    const rr = risk > 0 ? reward / risk : null;

    const sim = simulateForward({
      candles,
      entryIndex: i,
      type: s.type,
      entry,
      sl,
      tp,
    });

    const pnl = computePnL(s.type, entry, sim.exit);
    balance += pnl;
    equityCurve.push({ index: sim.exitIndex, equity: balance });

    trades.push({
      index: trades.length + 1,
      backtestIndex: i,
      pair: symbol,
      timeframe,
      type: s.type,
      entry,
      sl,
      tp,
      exit: sim.exit,
      result: sim.result,
      pnl,
      balance,
      confidence: safeNum(s.confidence, null),
      rr: rr ? clamp(rr, 0, 100) : null,
      reason: s.reason || null,
      created_at: new Date(last.timestamp || last.time || Date.now()).toISOString(),
    });

    cooldown = cooldownBars;
    i = sim.exitIndex;
  }

  const metrics = calcMetrics(trades, equityCurve);

  return {
    strategy_name: strategy === "LSBR" ? "OGFX_LSBR_PLAYBOOK" : "OGFX_ELITE_SMC",
    pair: symbol,
    timeframe,
    initialBalance: safeNum(initialBalance, 1000),
    finalBalance: parseFloat(balance.toFixed(2)),
    metrics,
    trades,
    equityCurve,
  };
}
