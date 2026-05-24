export type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type SignalSide = "BUY" | "SELL" | "NO_SETUP";
export type ConfirmationType = "BOS" | "MSS" | "ENGULF" | null;

export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type HtfBiasResult = {
  bias: Bias;
  swingHigh: number;
  swingLow: number;
};

export type LiquidityResult = {
  bsl: number[];
  ssl: number[];
  nearestBSL: number;
  nearestSSL: number;
};

export type SweepResult = {
  swept: boolean;
  sweepType: "BSL" | "SSL" | null;
  sweepPrice: number;
  sweepCandle: number;
};

export type DisplacementResult = {
  displaced: boolean;
  direction: "UP" | "DOWN" | null;
  displacementSize: number;
  displacementCandle: number;
};

export type ConfirmationResult = {
  confirmed: boolean;
  confirmationType: ConfirmationType;
  confirmationCandle: number;
};

export type SmcSignal = {
  pair: string;
  timeframe: string;
  bias: Bias;
  liquiditySide: "BSL" | "SSL" | "NONE";
  sweepConfirmed: boolean;
  displacementConfirmed: boolean;
  entryConfirmation: "BOS" | "MSS" | "ENGULF" | "NONE";
  signal: SignalSide;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  timestamp: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export type SmcAnalysis = {
  htfBias: HtfBiasResult;
  liquidity: LiquidityResult;
  sweep: SweepResult;
  displacement: DisplacementResult;
  confirmation: ConfirmationResult;
  signal: SmcSignal;
};

const EQ_TOLERANCE = 0.0005;
const STOP_BUFFER = 0.0002;

function isValidCandle(candle: Candle) {
  return [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite);
}

function pctDiff(a: number, b: number) {
  const base = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / base;
}

function roundLevel(value: number) {
  return Number(value.toFixed(6));
}

function bodySize(candle: Candle) {
  return Math.abs(candle.close - candle.open);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function findSwingHighIndexes(candles: Candle[], left = 2, right = 2) {
  const indexes: number[] = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const candle = candles[i];
    let isSwing = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j !== i && candles[j].high >= candle.high) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) indexes.push(i);
  }
  return indexes;
}

function findSwingLowIndexes(candles: Candle[], left = 2, right = 2) {
  const indexes: number[] = [];
  for (let i = left; i < candles.length - right; i += 1) {
    const candle = candles[i];
    let isSwing = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j !== i && candles[j].low <= candle.low) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) indexes.push(i);
  }
  return indexes;
}

function fallbackSwingHigh(candles: Candle[]) {
  return candles.reduce((max, candle) => Math.max(max, candle.high), candles[0]?.high ?? 0);
}

function fallbackSwingLow(candles: Candle[]) {
  return candles.reduce((min, candle) => Math.min(min, candle.low), candles[0]?.low ?? 0);
}

export function detectHtfBias(input: Candle[]): HtfBiasResult {
  const candles = input.filter(isValidCandle).slice(-50);
  if (candles.length < 10) {
    return { bias: "NEUTRAL", swingHigh: candles.at(-1)?.high ?? 0, swingLow: candles.at(-1)?.low ?? 0 };
  }

  const swingHighIndexes = findSwingHighIndexes(candles);
  const swingLowIndexes = findSwingLowIndexes(candles);
  const lastHigh = swingHighIndexes.at(-1);
  const prevHigh = swingHighIndexes.at(-2);
  const lastLow = swingLowIndexes.at(-1);
  const prevLow = swingLowIndexes.at(-2);

  const swingHigh = lastHigh == null ? fallbackSwingHigh(candles) : candles[lastHigh].high;
  const swingLow = lastLow == null ? fallbackSwingLow(candles) : candles[lastLow].low;

  if (lastHigh != null && prevHigh != null && lastLow != null && prevLow != null) {
    const higherHigh = candles[lastHigh].high > candles[prevHigh].high;
    const higherLow = candles[lastLow].low > candles[prevLow].low;
    const lowerHigh = candles[lastHigh].high < candles[prevHigh].high;
    const lowerLow = candles[lastLow].low < candles[prevLow].low;

    if (higherHigh && higherLow) return { bias: "BULLISH", swingHigh, swingLow };
    if (lowerHigh && lowerLow) return { bias: "BEARISH", swingHigh, swingLow };
  }

  const first = candles[0];
  const last = candles[candles.length - 1];
  if (last.close > first.close * 1.002 && swingLow > fallbackSwingLow(candles.slice(0, -5))) {
    return { bias: "BULLISH", swingHigh, swingLow };
  }
  if (last.close < first.close * 0.998 && swingHigh < fallbackSwingHigh(candles.slice(0, -5))) {
    return { bias: "BEARISH", swingHigh, swingLow };
  }

  return { bias: "NEUTRAL", swingHigh, swingLow };
}

function clusterEqualLevels(levels: number[]) {
  const sorted = levels.filter(Number.isFinite).sort((a, b) => a - b);
  const clusters: number[][] = [];

  for (const level of sorted) {
    const existing = clusters.find((cluster) => pctDiff(average(cluster), level) <= EQ_TOLERANCE);
    if (existing) existing.push(level);
    else clusters.push([level]);
  }

  return clusters
    .filter((cluster) => cluster.length >= 3)
    .map((cluster) => roundLevel(average(cluster)));
}

export function detectLiquidityPools(input: Candle[]): LiquidityResult {
  const candles = input.filter(isValidCandle);
  const current = candles.at(-1)?.close ?? 0;
  const bsl = clusterEqualLevels(candles.map((candle) => candle.high));
  const ssl = clusterEqualLevels(candles.map((candle) => candle.low));

  const nearestBSL =
    bsl.filter((level) => level > current).sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0] ??
    bsl.sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0] ??
    0;
  const nearestSSL =
    ssl.filter((level) => level < current).sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0] ??
    ssl.sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0] ??
    0;

  return { bsl, ssl, nearestBSL, nearestSSL };
}

export function detectSweep(input: Candle[], lookback = 30): SweepResult {
  const candles = input.filter(isValidCandle);
  const start = Math.max(1, candles.length - lookback);

  for (let i = candles.length - 1; i >= start; i -= 1) {
    const prior = candles.slice(Math.max(0, i - 80), i);
    const pools = detectLiquidityPools(prior);
    const candle = candles[i];
    const sweptBsl = pools.bsl.find((level) => candle.high > level && candle.close < level);
    if (sweptBsl != null) {
      return { swept: true, sweepType: "BSL", sweepPrice: candle.high, sweepCandle: i };
    }

    const sweptSsl = pools.ssl.find((level) => candle.low < level && candle.close > level);
    if (sweptSsl != null) {
      return { swept: true, sweepType: "SSL", sweepPrice: candle.low, sweepCandle: i };
    }
  }

  return { swept: false, sweepType: null, sweepPrice: 0, sweepCandle: -1 };
}

export function detectDisplacement(input: Candle[], sweep: SweepResult): DisplacementResult {
  const candles = input.filter(isValidCandle);
  if (!sweep.swept || sweep.sweepCandle < 0) {
    return { displaced: false, direction: null, displacementSize: 0, displacementCandle: -1 };
  }

  for (let i = sweep.sweepCandle + 1; i < candles.length; i += 1) {
    const candle = candles[i];
    const previous = candles.slice(Math.max(0, i - 10), i);
    const avgBody = average(previous.map(bodySize));
    const size = bodySize(candle);
    const bullish = candle.close > candle.open;
    const bearish = candle.close < candle.open;

    if (avgBody > 0 && size > avgBody * 1.5) {
      if (sweep.sweepType === "SSL" && bullish) {
        return { displaced: true, direction: "UP", displacementSize: size, displacementCandle: i };
      }
      if (sweep.sweepType === "BSL" && bearish) {
        return { displaced: true, direction: "DOWN", displacementSize: size, displacementCandle: i };
      }
    }
  }

  return { displaced: false, direction: null, displacementSize: 0, displacementCandle: -1 };
}

function isBullishEngulf(current: Candle, previous: Candle) {
  return current.close > current.open && previous.close < previous.open && current.close > previous.open && current.open < previous.close;
}

function isBearishEngulf(current: Candle, previous: Candle) {
  return current.close < current.open && previous.close > previous.open && current.close < previous.open && current.open > previous.close;
}

export function detectConfirmation(input: Candle[], displacement: DisplacementResult): ConfirmationResult {
  const candles = input.filter(isValidCandle);
  if (!displacement.displaced || displacement.displacementCandle < 0 || !displacement.direction) {
    return { confirmed: false, confirmationType: null, confirmationCandle: -1 };
  }

  const prior = candles.slice(Math.max(0, displacement.displacementCandle - 30), displacement.displacementCandle);
  const swingHighIndexes = findSwingHighIndexes(prior);
  const swingLowIndexes = findSwingLowIndexes(prior);
  const recentLowerHigh = swingHighIndexes.at(-1) == null ? fallbackSwingHigh(prior) : prior[swingHighIndexes.at(-1)!].high;
  const recentHigherLow = swingLowIndexes.at(-1) == null ? fallbackSwingLow(prior) : prior[swingLowIndexes.at(-1)!].low;

  for (let i = displacement.displacementCandle; i < candles.length; i += 1) {
    const candle = candles[i];
    const previous = candles[i - 1];

    if (displacement.direction === "UP") {
      if (candle.close > recentLowerHigh) {
        const type = candle.close > recentLowerHigh && candle.low > recentHigherLow ? "MSS" : "BOS";
        return { confirmed: true, confirmationType: type, confirmationCandle: i };
      }
      if (previous && isBullishEngulf(candle, previous)) {
        return { confirmed: true, confirmationType: "ENGULF", confirmationCandle: i };
      }
    }

    if (displacement.direction === "DOWN") {
      if (candle.close < recentHigherLow) {
        const type = candle.close < recentHigherLow && candle.high < recentLowerHigh ? "MSS" : "BOS";
        return { confirmed: true, confirmationType: type, confirmationCandle: i };
      }
      if (previous && isBearishEngulf(candle, previous)) {
        return { confirmed: true, confirmationType: "ENGULF", confirmationCandle: i };
      }
    }
  }

  return { confirmed: false, confirmationType: null, confirmationCandle: -1 };
}

function emptySignal(pair: string, timeframe: string, bias: Bias, timestamp: string): SmcSignal {
  return {
    pair,
    timeframe,
    bias,
    liquiditySide: "NONE",
    sweepConfirmed: false,
    displacementConfirmed: false,
    entryConfirmation: "NONE",
    signal: "NO_SETUP",
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    riskReward: 0,
    timestamp,
    confidence: "LOW",
  };
}

function nearestTarget(levels: number[], entry: number, side: "BUY" | "SELL", fallback: number) {
  const sorted =
    side === "BUY"
      ? levels.filter((level) => level > entry).sort((a, b) => a - b)
      : levels.filter((level) => level < entry).sort((a, b) => b - a);
  return sorted[0] ?? fallback;
}

export function runSmcEngine(candlesInput: Candle[], pair: string, timeframe: string): SmcAnalysis {
  const candles = candlesInput.filter(isValidCandle);
  const latest = candles.at(-1);
  const timestamp = latest?.time ?? new Date(0).toISOString();
  const htfBias = detectHtfBias(candles);
  const liquidity = detectLiquidityPools(candles.slice(-100));
  const sweep = detectSweep(candles);
  const displacement = detectDisplacement(candles, sweep);
  const confirmation = detectConfirmation(candles, displacement);
  const noSetup = emptySignal(pair, timeframe, htfBias.bias, timestamp);

  if (!latest || !sweep.swept || !displacement.displaced || !confirmation.confirmed) {
    return { htfBias, liquidity, sweep, displacement, confirmation, signal: noSetup };
  }

  const signal =
    htfBias.bias === "BULLISH" && sweep.sweepType === "SSL" && displacement.direction === "UP"
      ? "BUY"
      : htfBias.bias === "BEARISH" && sweep.sweepType === "BSL" && displacement.direction === "DOWN"
        ? "SELL"
        : "NO_SETUP";

  if (signal === "NO_SETUP") {
    return { htfBias, liquidity, sweep, displacement, confirmation, signal: noSetup };
  }

  const entry = latest.close;
  const stopLoss =
    signal === "BUY"
      ? sweep.sweepPrice * (1 - STOP_BUFFER)
      : sweep.sweepPrice * (1 + STOP_BUFFER);
  const fallbackTp =
    signal === "BUY"
      ? entry + Math.abs(entry - stopLoss) * 2
      : entry - Math.abs(entry - stopLoss) * 2;
  const takeProfit =
    signal === "BUY"
      ? nearestTarget(liquidity.bsl, entry, "BUY", fallbackTp)
      : nearestTarget(liquidity.ssl, entry, "SELL", fallbackTp);
  const risk = Math.abs(entry - stopLoss);
  const reward = signal === "BUY" ? takeProfit - entry : entry - takeProfit;
  const riskReward = risk > 0 && reward > 0 ? Number((reward / risk).toFixed(2)) : 0;

  if (riskReward <= 0) {
    return { htfBias, liquidity, sweep, displacement, confirmation, signal: noSetup };
  }

  const confidence =
    confirmation.confirmationType === "MSS" && riskReward >= 2
      ? "HIGH"
      : confirmation.confirmationType === "ENGULF"
        ? "MEDIUM"
        : riskReward >= 1.5
          ? "MEDIUM"
          : "LOW";

  return {
    htfBias,
    liquidity,
    sweep,
    displacement,
    confirmation,
    signal: {
      pair,
      timeframe,
      bias: htfBias.bias,
      liquiditySide: sweep.sweepType ?? "NONE",
      sweepConfirmed: sweep.swept,
      displacementConfirmed: displacement.displaced,
      entryConfirmation: confirmation.confirmationType ?? "NONE",
      signal,
      entry: roundLevel(entry),
      stopLoss: roundLevel(stopLoss),
      takeProfit: roundLevel(takeProfit),
      riskReward,
      timestamp,
      confidence,
    },
  };
}
