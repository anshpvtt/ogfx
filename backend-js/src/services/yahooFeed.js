import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

const SYMBOL_MAP = {
  XAUUSD: "GC=F",
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "JPY=X",
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD",
  USOIL: "CL=F",
  NAS100: "NQ=F",
  SPX500: "ES=F",
};

const INTERVAL_MAP = {
  "1": "1m",
  "1m": "1m",
  "5": "5m",
  "5m": "5m",
  "15": "15m",
  "15m": "15m",
  "30": "30m",
  "30m": "30m",
  "60": "1h",
  "1h": "1h",
  "1H": "1h",
  "4h": "1h",
  "4H": "1h",
  "1d": "1d",
  "1D": "1d",
  D: "1d",
};

function defaultPeriod1(interval) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (interval === "1m") return new Date(now - 6 * day);
  if (interval === "5m") return new Date(now - 28 * day);
  if (interval === "15m" || interval === "30m") return new Date(now - 58 * day);
  if (interval === "1h") return new Date(now - 365 * day);
  return new Date(now - 730 * day);
}

function cleanCandle(quote) {
  const open = Number(quote.open);
  const high = Number(quote.high);
  const low = Number(quote.low);
  const close = Number(quote.close);
  if (![open, high, low, close].every(Number.isFinite)) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;

  const time = quote.date instanceof Date ? quote.date : new Date(quote.date ?? Date.now());
  return {
    open,
    high,
    low,
    close,
    volume: Number(quote.volume ?? 0),
    timestamp: time.getTime(),
    time: time.toISOString(),
  };
}

export function toYahooSymbol(symbol) {
  return SYMBOL_MAP[String(symbol || "").toUpperCase()] || String(symbol || "").toUpperCase();
}

export function normalizeTimeframe(timeframe = "1h") {
  return INTERVAL_MAP[String(timeframe)] || INTERVAL_MAP[String(timeframe).toUpperCase()] || "1h";
}

export async function fetchYahooCandles({
  symbol,
  timeframe = "1h",
  startDate,
  endDate,
  limit = 300,
} = {}) {
  const yahooSymbol = toYahooSymbol(symbol);
  const interval = normalizeTimeframe(timeframe);
  const period1 = startDate ? new Date(startDate) : defaultPeriod1(interval);
  const period2 = endDate ? new Date(endDate) : new Date();

  const response = await yahooFinance.chart(yahooSymbol, {
    period1,
    period2,
    interval,
  });

  const candles = (response?.quotes || [])
    .map(cleanCandle)
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);

  return limit ? candles.slice(-Math.max(1, Number(limit))) : candles;
}
