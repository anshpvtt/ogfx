import { logger } from "../../services/logger.js";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toPipDecimals(symbol) {
  return symbol.includes("JPY") ? 3 : 5;
}

function roundPrice(symbol, price) {
  const d = toPipDecimals(symbol);
  return parseFloat(price.toFixed(d));
}

function simulateTrade({ candles, entryIndex, type, entry, stopLoss, takeProfit, maxBars = 96 }) {
  const dir = type === "BUY" ? 1 : -1;
  for (let i = entryIndex + 1; i < candles.length && i <= entryIndex + maxBars; i++) {
    const c = candles[i];
    const hitSL = dir === 1 ? c.low <= stopLoss : c.high >= stopLoss;
    const hitTP = dir === 1 ? c.high >= takeProfit : c.low <= takeProfit;

    // Conservative: if both touched same bar, assume SL first
    if (hitSL && hitTP) return { outcome: "loss", exitIndex: i };
    if (hitSL) return { outcome: "loss", exitIndex: i };
    if (hitTP) return { outcome: "win", exitIndex: i };
  }
  return { outcome: "timeout", exitIndex: Math.min(candles.length - 1, entryIndex + maxBars) };
}

function computeRR(type, entry, stopLoss, takeProfit) {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (!risk || !Number.isFinite(risk) || !Number.isFinite(reward)) return null;
  return reward / risk;
}

export async function runBacktest({
  symbol,
  candles,
  engineName,
  engines,
  minConfidence = 70,
  slAtrMult = 2,
  tpAtrMult = 3,
  warmupBars = 50,
  maxBarsInTrade = 96,
  cooldownBars = 10,
}) {
  const eliteEngine = engines?.eliteEngine;
  const smcEngine = engines?.smcEngine;
  const fallbackEngine = engines?.fallbackEngine; // { ruleEngine, contextEngine, generateSignal }

  const trades = [];
  let i = warmupBars;
  let cooldown = 0;

  while (i < candles.length - 2) {
    if (cooldown > 0) {
      cooldown -= 1;
      i += 1;
      continue;
    }

    const window = candles.slice(0, i + 1);
    const last = window[window.length - 1];
    const atr = last?.indicators?.atr?.[14] || last?.atr || null;

    let signal = null;
    let engine = engineName;

    try {
      if (engineName === "ELITE" && eliteEngine) {
        const data = { candles: window, close: last.close, indicators: last.indicators };
        const r = eliteEngine.analyze(symbol, data);
        if (r?.valid && r?.signal?.confidence >= minConfidence) signal = r.signal;
      } else if (engineName === "SMC" && smcEngine) {
        const data = { candles: window, close: last.close, indicators: last.indicators };
        const s = smcEngine.analyze(symbol, data);
        if (s?.confidence >= minConfidence) signal = s;
      } else if (engineName === "FALLBACK" && fallbackEngine) {
        const data = { candles: window, close: last.close, indicators: last.indicators, levels: last.levels };
        const rule = fallbackEngine.ruleEngine.evaluate(data);
        if (rule?.valid) {
          const context = fallbackEngine.contextEngine.analyze(data, rule);
          if (context?.valid) {
            signal = fallbackEngine.generateSignal(symbol, rule.type, data, context);
          }
        }
      } else if (engineName === "AUTO") {
        // AUTO tries ELITE → SMC → FALLBACK
        engine = "AUTO";
        if (eliteEngine) {
          const data = { candles: window, close: last.close, indicators: last.indicators };
          const r = eliteEngine.analyze(symbol, data);
          if (r?.valid && r?.signal?.confidence >= minConfidence) {
            signal = r.signal;
            engine = "ELITE";
          }
        }
        if (!signal && smcEngine) {
          const data = { candles: window, close: last.close, indicators: last.indicators };
          const s = smcEngine.analyze(symbol, data);
          if (s?.confidence >= minConfidence) {
            signal = s;
            engine = "SMC";
          }
        }
        if (!signal && fallbackEngine) {
          const data = { candles: window, close: last.close, indicators: last.indicators, levels: last.levels };
          const rule = fallbackEngine.ruleEngine.evaluate(data);
          if (rule?.valid) {
            const context = fallbackEngine.contextEngine.analyze(data, rule);
            if (context?.valid) {
              signal = fallbackEngine.generateSignal(symbol, rule.type, data, context);
              engine = "FALLBACK";
            }
          }
        }
      }
    } catch (e) {
      logger.warn(`Backtest analyze error at bar ${i}: ${e?.message || e}`);
    }

    if (!signal || !signal.type) {
      i += 1;
      continue;
    }

    const type = signal.type;
    const entry = signal.entry ?? last.close;
    const atrUsed = atr || Math.abs(last.high - last.low) || Math.abs(last.close * 0.001);
    const slDist = atrUsed * slAtrMult;
    const tpDist = atrUsed * tpAtrMult;
    const stopLoss = type === "BUY" ? entry - slDist : entry + slDist;
    const takeProfit = type === "BUY" ? entry + tpDist : entry - tpDist;
    const rr = computeRR(type, entry, stopLoss, takeProfit);

    const sim = simulateTrade({
      candles: window.concat(candles.slice(i + 1)), // keep full forward
      entryIndex: i,
      type,
      entry,
      stopLoss,
      takeProfit,
      maxBars: maxBarsInTrade,
    });

    trades.push({
      engine,
      type,
      entryIndex: i,
      exitIndex: sim.exitIndex,
      entry: roundPrice(symbol, entry),
      stopLoss: roundPrice(symbol, stopLoss),
      takeProfit: roundPrice(symbol, takeProfit),
      riskReward: rr ? clamp(rr, 0, 100) : null,
      outcome: sim.outcome,
      confidence: signal.confidence ?? null,
      timestamp: new Date(last.timestamp || last.time || Date.now()).toISOString(),
    });

    cooldown = cooldownBars;
    i = sim.exitIndex + 1;
  }

  const wins = trades.filter((t) => t.outcome === "win").length;
  const losses = trades.filter((t) => t.outcome === "loss").length;
  const timeouts = trades.filter((t) => t.outcome === "timeout").length;
  const total = trades.length;
  const winRate = total ? wins / total : 0;
  const avgRR = total
    ? trades.reduce((s, t) => s + (t.riskReward || 0), 0) / total
    : 0;
  const expectancy = total ? (winRate * avgRR) - ((1 - winRate) * 1) : 0;

  return {
    symbol,
    engine: engineName,
    totalTrades: total,
    wins,
    losses,
    timeouts,
    winRate,
    avgRiskReward: avgRR,
    expectancyR: expectancy,
    params: {
      minConfidence,
      slAtrMult,
      tpAtrMult,
      warmupBars,
      maxBarsInTrade,
      cooldownBars,
    },
    trades: trades.slice(-200),
  };
}

