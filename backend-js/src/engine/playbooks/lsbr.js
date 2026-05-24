function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 5) {
  return Number(Number(value).toFixed(digits));
}

function getDigits(symbol) {
  return symbol.includes("JPY") ? 3 : 5;
}

function getBodyStrength(candle) {
  const range = Math.max(1e-9, candle.high - candle.low);
  return Math.abs(candle.close - candle.open) / range;
}

function isBullishEngulfing(previous, current) {
  return previous.close < previous.open &&
    current.close > current.open &&
    current.close >= previous.open &&
    current.open <= previous.close;
}

function isBearishEngulfing(previous, current) {
  return previous.close > previous.open &&
    current.close < current.open &&
    current.close <= previous.open &&
    current.open >= previous.close;
}

function clusterLevels(values, tolerance) {
  const clusters = [];

  for (const value of values) {
    let cluster = clusters.find((item) => Math.abs(item.level - value) <= tolerance);
    if (!cluster) {
      cluster = { level: value, count: 0, values: [] };
      clusters.push(cluster);
    }
    cluster.values.push(value);
    cluster.count += 1;
    cluster.level = average(cluster.values);
  }

  return clusters.filter((cluster) => cluster.count >= 2);
}

function detectSweep(candles, direction, level, atr) {
  const recent = candles.slice(-4);
  const tolerance = Math.max(atr * 0.12, level * 0.00015);

  for (let index = 0; index < recent.length; index += 1) {
    const candle = recent[index];
    if (direction === "BUY") {
      const swept = candle.low < level - tolerance && candle.close > level;
      if (swept) {
        return {
          found: true,
          candleIndexFromEnd: recent.length - index,
          extreme: candle.low,
          reclaim: candle.close,
          type: "sell-side",
        };
      }
    } else {
      const swept = candle.high > level + tolerance && candle.close < level;
      if (swept) {
        return {
          found: true,
          candleIndexFromEnd: recent.length - index,
          extreme: candle.high,
          reclaim: candle.close,
          type: "buy-side",
        };
      }
    }
  }

  return { found: false };
}

function detectBos(candles, direction) {
  const recent = candles.slice(-10);
  const current = recent[recent.length - 1];
  const lookback = recent.slice(0, -1);

  if (direction === "BUY") {
    const brokenLevel = Math.max(...lookback.map((candle) => candle.high));
    return {
      found: current.close > brokenLevel,
      level: brokenLevel,
    };
  }

  const brokenLevel = Math.min(...lookback.map((candle) => candle.low));
  return {
    found: current.close < brokenLevel,
    level: brokenLevel,
  };
}

function buildChecklist({ biasAligned, hasLiquidityPool, hasSweep, hasConfirmation, hasBos, zoneStrength }) {
  return [
    { label: "HTF aligned", passed: biasAligned },
    { label: "Liquidity pool visible", passed: hasLiquidityPool },
    { label: "Sweep detected", passed: hasSweep },
    { label: "Confirmation candle", passed: hasConfirmation },
    { label: "Break of structure", passed: hasBos },
    { label: "Zone strength", passed: zoneStrength >= 65 },
  ];
}

export function evaluateLsbrSetup({ symbol, candles }) {
  if (!Array.isArray(candles) || candles.length < 80) {
    return {
      strategy: "LSBR",
      actionable: false,
      score: 0,
      grade: "D",
      summary: "Not enough candles to evaluate LSBR setup.",
      checklist: [],
    };
  }

  const digits = getDigits(symbol);
  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const recent = candles.slice(-26, -1);
  const atr = current.indicators?.atr?.[14] || average(candles.slice(-14).map((candle) => candle.high - candle.low));
  const tolerance = Math.max(atr * 0.35, current.close * 0.00035);

  const lowClusters = clusterLevels(recent.map((candle) => candle.low), tolerance);
  const highClusters = clusterLevels(recent.map((candle) => candle.high), tolerance);
  const closestSellSide = lowClusters.sort((a, b) => Math.abs(a.level - current.close) - Math.abs(b.level - current.close))[0] || null;
  const closestBuySide = highClusters.sort((a, b) => Math.abs(a.level - current.close) - Math.abs(b.level - current.close))[0] || null;

  const ema20 = current.indicators?.ema?.[20] || current.close;
  const ema50 = current.indicators?.ema?.[50] || current.close;
  const ema200 = current.indicators?.ema?.[200] || current.close;
  const bullishBias = current.close > ema50 && ema20 >= ema50 && ema50 >= ema200;
  const bearishBias = current.close < ema50 && ema20 <= ema50 && ema50 <= ema200;

  const bullishSweep = closestSellSide ? detectSweep(candles, "BUY", closestSellSide.level, atr) : { found: false };
  const bearishSweep = closestBuySide ? detectSweep(candles, "SELL", closestBuySide.level, atr) : { found: false };

  const bullishConfirmation = getBodyStrength(current) >= 0.58 || isBullishEngulfing(previous, current);
  const bearishConfirmation = getBodyStrength(current) >= 0.58 || isBearishEngulfing(previous, current);

  const bullishBos = detectBos(candles, "BUY");
  const bearishBos = detectBos(candles, "SELL");

  const zoneStrength = clamp(
    (
      (closestSellSide?.count || 0) * 12 +
      (closestBuySide?.count || 0) * 12 +
      clamp(getBodyStrength(previous) * 30, 0, 30)
    ),
    0,
    100
  );

  const longScore = (
    (bullishBias ? 25 : 0) +
    (closestSellSide ? 15 : 0) +
    (bullishSweep.found ? 25 : 0) +
    (bullishConfirmation ? 15 : 0) +
    (bullishBos.found ? 15 : 0) +
    (zoneStrength >= 65 ? 5 : 0)
  );

  const shortScore = (
    (bearishBias ? 25 : 0) +
    (closestBuySide ? 15 : 0) +
    (bearishSweep.found ? 25 : 0) +
    (bearishConfirmation ? 15 : 0) +
    (bearishBos.found ? 15 : 0) +
    (zoneStrength >= 65 ? 5 : 0)
  );

  const direction = longScore >= shortScore ? "BUY" : "SELL";
  const score = Math.max(longScore, shortScore);
  const biasAligned = direction === "BUY" ? bullishBias : bearishBias;
  const hasLiquidityPool = direction === "BUY" ? Boolean(closestSellSide) : Boolean(closestBuySide);
  const hasSweep = direction === "BUY" ? bullishSweep.found : bearishSweep.found;
  const hasConfirmation = direction === "BUY" ? bullishConfirmation : bearishConfirmation;
  const hasBos = direction === "BUY" ? bullishBos.found : bearishBos.found;
  const activeLevel = direction === "BUY" ? closestSellSide?.level : closestBuySide?.level;
  const sweep = direction === "BUY" ? bullishSweep : bearishSweep;
  const structureLevel = direction === "BUY" ? bullishBos.level : bearishBos.level;
  const oppositeLevel = direction === "BUY" ? closestBuySide?.level : closestSellSide?.level;

  const riskReference = sweep.found
    ? sweep.extreme
    : direction === "BUY"
      ? current.close - atr * 1.25
      : current.close + atr * 1.25;

  const entry = current.close;
  const stopLoss = direction === "BUY"
    ? riskReference - atr * 0.15
    : riskReference + atr * 0.15;

  const rawRisk = Math.abs(entry - stopLoss);
  const defaultTarget = direction === "BUY"
    ? entry + rawRisk * 2.6
    : entry - rawRisk * 2.6;
  const takeProfit = oppositeLevel
    ? direction === "BUY"
      ? Math.max(defaultTarget, oppositeLevel)
      : Math.min(defaultTarget, oppositeLevel)
    : defaultTarget;
  const riskReward = rawRisk > 0 ? Math.abs(takeProfit - entry) / rawRisk : 0;

  const actionable = score >= 70 && biasAligned && hasLiquidityPool && hasSweep && hasConfirmation;
  const grade =
    score >= 90 ? "A+" :
    score >= 82 ? "A" :
    score >= 74 ? "B" :
    score >= 65 ? "C" : "D";

  const checklist = buildChecklist({
    biasAligned,
    hasLiquidityPool,
    hasSweep,
    hasConfirmation,
    hasBos,
    zoneStrength,
  });

  const summary = actionable
    ? `${direction} LSBR setup: liquidity sweep, ${hasBos ? "BOS confirmed" : "confirmation candle confirmed"}, trade back toward the next liquidity pool.`
    : "No clean LSBR setup yet. Wait for a clearer sweep plus confirmation inside a stronger zone.";

  return {
    strategy: "LSBR",
    actionable,
    direction,
    score,
    grade,
    summary,
    checklist,
    reasoning: [
      biasAligned ? "HTF EMA alignment supports direction." : "HTF bias is mixed.",
      hasLiquidityPool ? `Liquidity pool identified near ${round(activeLevel, digits)}.` : "No clean equal-high/equal-low liquidity pool nearby.",
      hasSweep ? `Recent ${sweep.type} sweep detected.` : "Liquidity sweep not confirmed.",
      hasConfirmation ? "Confirmation candle is strong enough." : "Confirmation candle is weak.",
      hasBos ? `BOS around ${round(structureLevel, digits)} is confirmed.` : "BOS still pending.",
      zoneStrength >= 65 ? "Zone quality is strong." : "Zone quality is average or weak.",
    ],
    market: {
      trend: bullishBias ? "bullish" : bearishBias ? "bearish" : "neutral",
      close: round(current.close, digits),
      ema20: round(ema20, digits),
      ema50: round(ema50, digits),
      ema200: round(ema200, digits),
      atr: round(atr, digits),
      liquidity: {
        sellSide: closestSellSide ? round(closestSellSide.level, digits) : null,
        buySide: closestBuySide ? round(closestBuySide.level, digits) : null,
      },
    },
    signal: actionable ? {
      type: direction,
      entry: round(entry, digits),
      stopLoss: round(stopLoss, digits),
      takeProfit: round(takeProfit, digits),
      confidence: clamp(score, 0, 99),
      riskReward: Number(riskReward.toFixed(2)),
      reason: summary,
    } : null,
  };
}
