function round(value, decimals = 5) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(decimals));
}

function decimalsForSymbol(symbol) {
  if (String(symbol).includes("JPY")) return 3;
  if (String(symbol).includes("XAU") || String(symbol).includes("BTC") || String(symbol).includes("ETH")) return 2;
  if (String(symbol).includes("NAS") || String(symbol).includes("SPX") || String(symbol).includes("OIL")) return 2;
  return 5;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function atr(candles, period = 14) {
  const sample = candles.slice(-period - 1);
  if (sample.length < 2) return 0;
  return average(sample.slice(1).map((candle, index) => {
    const previous = sample[index];
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close)
    );
  }));
}

export function normalizeCandles(candles) {
  return (candles || [])
    .map((candle) => ({
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume ?? 0),
      timestamp: Number(candle.timestamp ?? new Date(candle.time ?? candle.date ?? Date.now()).getTime()),
      time: candle.time ?? new Date(candle.timestamp ?? candle.date ?? Date.now()).toISOString(),
    }))
    .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function detectSwings(candles, lookback = 3) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const candle = candles[i];
    const left = candles.slice(i - lookback, i);
    const right = candles.slice(i + 1, i + lookback + 1);
    const isHigh = [...left, ...right].every((other) => candle.high > other.high);
    const isLow = [...left, ...right].every((other) => candle.low < other.low);
    if (isHigh) swings.push({ type: "high", index: i, price: candle.high, timestamp: candle.timestamp });
    if (isLow) swings.push({ type: "low", index: i, price: candle.low, timestamp: candle.timestamp });
  }
  return swings;
}

export function detectStructure(candles, swings) {
  const last = candles.at(-1);
  const previousHigh = swings.filter((swing) => swing.type === "high" && swing.index < candles.length - 2).at(-1);
  const previousLow = swings.filter((swing) => swing.type === "low" && swing.index < candles.length - 2).at(-1);
  const last20 = candles.slice(-20);
  const bias = last20.at(-1)?.close > last20[0]?.open ? "BULLISH" : "BEARISH";
  let lastBOS = null;
  let choch = null;

  if (previousHigh && last.close > previousHigh.price) {
    lastBOS = { direction: "BULLISH", level: previousHigh.price, index: candles.length - 1 };
    if (bias === "BEARISH") choch = { direction: "BULLISH", level: previousHigh.price };
  }

  if (previousLow && last.close < previousLow.price) {
    lastBOS = { direction: "BEARISH", level: previousLow.price, index: candles.length - 1 };
    if (bias === "BULLISH") choch = { direction: "BEARISH", level: previousLow.price };
  }

  return { bias, lastBOS, choch, previousHigh, previousLow };
}

export function detectOrderBlocks(candles, structure) {
  if (!structure?.lastBOS) return [];
  const direction = structure.lastBOS.direction;
  const search = candles.slice(Math.max(0, candles.length - 35), -1).reverse();
  const blocks = [];

  for (const candle of search) {
    const bullish = candle.close > candle.open;
    const bearish = candle.close < candle.open;
    if (direction === "BULLISH" && bearish) {
      blocks.push({ type: "bullish", low: candle.low, high: candle.high, source: "last bearish candle before bullish BOS" });
      break;
    }
    if (direction === "BEARISH" && bullish) {
      blocks.push({ type: "bearish", low: candle.low, high: candle.high, source: "last bullish candle before bearish BOS" });
      break;
    }
  }

  return blocks;
}

export function detectFVG(candles) {
  const gaps = [];
  for (let i = 2; i < candles.length; i += 1) {
    const first = candles[i - 2];
    const third = candles[i];
    if (third.low > first.high) {
      gaps.push({ type: "bullish", low: first.high, high: third.low, index: i });
    }
    if (third.high < first.low) {
      gaps.push({ type: "bearish", low: third.high, high: first.low, index: i });
    }
  }
  return gaps.slice(-20);
}

export function runSMCAnalysis(rawCandles, { symbol = "XAUUSD" } = {}) {
  const candles = normalizeCandles(rawCandles);
  if (candles.length < 40) {
    return { hasSetup: false, reason: "Not enough candles for SMC analysis" };
  }

  const decimals = decimalsForSymbol(symbol);
  const currentPrice = candles.at(-1).close;
  const volatility = atr(candles) || Math.max(currentPrice * 0.002, 0.0001);
  const last20 = candles.slice(-20);
  const bias = last20.at(-1).close > last20[0].open ? "BULLISH" : "BEARISH";
  const swings = detectSwings(candles, 3);
  const structure = detectStructure(candles, swings);
  const orderBlocks = detectOrderBlocks(candles, structure);
  const fvgs = detectFVG(candles);
  const activeOB = orderBlocks.find((ob) => currentPrice >= ob.low && currentPrice <= ob.high);
  const activeFVG = fvgs.find((fvg) => currentPrice >= fvg.low && currentPrice <= fvg.high);
  const nearOB = orderBlocks.find((ob) => currentPrice >= ob.low - volatility * 0.35 && currentPrice <= ob.high + volatility * 0.35);
  const nearFVG = fvgs.find((fvg) => currentPrice >= fvg.low - volatility * 0.35 && currentPrice <= fvg.high + volatility * 0.35);
  const zone = activeOB || activeFVG || nearOB || nearFVG;

  if (!zone || !structure.lastBOS) {
    return {
      hasSetup: false,
      reason: "Waiting for price to trade into a valid order block or FVG after BOS/CHOCH",
      bias,
      currentPrice,
      swings: swings.slice(-8),
      structure,
      orderBlocks,
      fvgs,
    };
  }

  const direction = bias === "BULLISH" ? "BUY" : "SELL";
  const entry = currentPrice;
  const sl = direction === "BUY"
    ? Math.min(zone.low, currentPrice - volatility * 0.8)
    : Math.max(zone.high, currentPrice + volatility * 0.8);
  const risk = Math.abs(entry - sl);
  const tp = direction === "BUY" ? entry + risk * 3 : entry - risk * 3;
  const confidence = Math.min(92, 62 + (activeOB || activeFVG ? 12 : 6) + (structure.choch ? 8 : 0) + (structure.lastBOS ? 10 : 0));

  return {
    hasSetup: true,
    direction,
    entry: round(entry, decimals),
    sl: round(sl, decimals),
    tp: round(tp, decimals),
    rr: 3,
    confidence,
    bias,
    currentPrice: round(currentPrice, decimals),
    activeOB: activeOB || nearOB || null,
    activeFVG: activeFVG || nearFVG || null,
    structure,
    orderBlocks,
    fvgs,
    reason: `${bias} bias with ${structure.lastBOS.direction} BOS and ${zone.type} ${activeOB || nearOB ? "order block" : "FVG"} confluence`,
  };
}

function simulateTrade(candles, startIndex, setup, initialBalance) {
  const side = setup.direction;
  const entry = setup.entry;
  const sl = setup.sl;
  const tp = setup.tp;
  let exit = candles[Math.min(candles.length - 1, startIndex + 50)];
  let result = "TIMEOUT";
  let exitPrice = exit.close;

  for (let i = startIndex + 1; i < Math.min(candles.length, startIndex + 80); i += 1) {
    const candle = candles[i];
    const hitTp = side === "BUY" ? candle.high >= tp : candle.low <= tp;
    const hitSl = side === "BUY" ? candle.low <= sl : candle.high >= sl;
    if (hitSl || hitTp) {
      result = hitTp && !hitSl ? "WIN" : "LOSS";
      exit = candle;
      exitPrice = result === "WIN" ? tp : sl;
      break;
    }
  }

  const direction = side === "BUY" ? 1 : -1;
  const pnl = (exitPrice - entry) * direction;
  const balance = initialBalance + pnl;
  return {
    date: new Date(exit.timestamp).toISOString(),
    type: side,
    entry,
    sl,
    tp,
    exit: round(exitPrice, 5),
    result,
    pnl: round(pnl, 2),
    balance: round(balance, 2),
    rr: setup.rr,
    confidence: setup.confidence,
    reason: setup.reason,
    exitIndex: candles.indexOf(exit),
  };
}

export function runSMCBacktest(rawCandles, { symbol = "XAUUSD", initialBalance = 10000 } = {}) {
  const candles = normalizeCandles(rawCandles);
  let balance = Number(initialBalance);
  let peak = balance;
  let maxDrawdown = 0;
  const trades = [];
  const equityCurve = [{ date: new Date(candles[0]?.timestamp ?? Date.now()).toISOString(), balance }];

  for (let i = 80; i < candles.length - 5; i += 1) {
    const setup = runSMCAnalysis(candles.slice(0, i + 1), { symbol });
    if (!setup.hasSetup || setup.confidence < 70) continue;

    const trade = simulateTrade(candles, i, setup, balance);
    balance = Number((balance + Number(trade.pnl || 0)).toFixed(2));
    trade.balance = balance;
    trade.index = trades.length + 1;
    trades.push(trade);
    equityCurve.push({ date: trade.date, balance });

    peak = Math.max(peak, balance);
    const drawdown = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    i = Math.max(i + 8, trade.exitIndex || i + 8);
  }

  const wins = trades.filter((trade) => trade.result === "WIN").length;
  const losses = trades.filter((trade) => trade.result === "LOSS").length;
  const grossWin = trades.filter((trade) => trade.pnl > 0).reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0));

  return {
    totalTrades: trades.length,
    winRate: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    totalPnl: round(balance - Number(initialBalance), 2),
    maxDrawdown: round(maxDrawdown, 2),
    rrAchieved: losses ? round(wins / losses, 2) : wins,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? 999 : 0,
    finalBalance: round(balance, 2),
    equityCurve,
    tradeLog: trades,
  };
}

