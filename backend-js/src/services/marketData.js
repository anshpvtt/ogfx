import axios from "axios";
import { logger } from "./logger.js";

export class MarketDataService {
  constructor() {
    this.cache = new Map();
    this.cacheDuration = 5000; // 5 seconds
    this.http = axios.create({
      timeout: Number(process.env.HTTP_TIMEOUT_MS || 10000),
    });
  }

  enrichCandles(candles) {
    if (!Array.isArray(candles) || candles.length === 0) return candles;

    const periods = { rsi: 14, atr: 14, ema: [20, 50, 200], avgVolume: 20 };
    const alpha = (p) => 2 / (p + 1);

    let prevClose = candles[0].close;
    let atrEma = 0;

    // EMA state
    const emaState = new Map(periods.ema.map((p) => [p, candles[0].close]));

    // RSI state (Wilder-like but using rolling avg via EMA for simplicity)
    let avgGain = 0;
    let avgLoss = 0;

    const volQueue = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const close = c.close;

      // EMA updates
      for (const p of periods.ema) {
        const prev = emaState.get(p);
        const next = (close - prev) * alpha(p) + prev;
        emaState.set(p, next);
      }

      // ATR update (EMA of TR)
      const tr1 = c.high - c.low;
      const tr2 = Math.abs(c.high - prevClose);
      const tr3 = Math.abs(c.low - prevClose);
      const tr = Math.max(tr1, tr2, tr3);
      atrEma = i === 0 ? tr : (tr - atrEma) * alpha(periods.atr) + atrEma;

      // RSI update
      const change = close - prevClose;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = i === 0 ? gain : (gain - avgGain) * alpha(periods.rsi) + avgGain;
      avgLoss = i === 0 ? loss : (loss - avgLoss) * alpha(periods.rsi) + avgLoss;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

      // Avg volume
      volQueue.push(c.volume || 0);
      if (volQueue.length > periods.avgVolume) volQueue.shift();
      const avgVol = volQueue.reduce((s, v) => s + v, 0) / (volQueue.length || 1);

      c.indicators = {
        rsi: { 14: rsi },
        ema: {
          20: emaState.get(20),
          50: emaState.get(50),
          200: emaState.get(200),
        },
        atr: { 14: atrEma },
        avgVolume: { 20: avgVol },
      };

      prevClose = close;
    }

    return candles;
  }

  async fetchData(symbol, opts = {}) {
    const timeframe = opts.timeframe || "15m";
    const limit = opts.limit || 200;
    const cacheKey = `${symbol}:${timeframe}:${limit}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    try {
      // Try Binance for crypto
      if (symbol.includes("BTC") || symbol.includes("ETH")) {
        return await this.fetchBinanceData(symbol, { timeframe, limit });
      }

      // Try TwelveData for forex/metals/indices first
      return await this.fetchForexData(symbol, { timeframe, limit });
    } catch (error) {
      logger.error(`Failed to fetch data for ${symbol}:`, error);
      const yahooData = await this.fetchYahooData(symbol, { timeframe, limit });
      if (yahooData) {
        return yahooData;
      }

      // Return mock data as last resort
      return this.getMockData(symbol, { timeframe, limit });
    }
  }

  async fetchBinanceData(symbol, opts = {}) {
    const binanceSymbol = symbol.replace("USD", "USDT");
    const timeframe = opts.timeframe || "15m";
    const limit = opts.limit || 200;
    const cacheKey = `${symbol}:${timeframe}:${limit}`;

    // Fetch klines (candlestick data)
    const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${encodeURIComponent(timeframe)}&limit=${encodeURIComponent(limit)}`;
    const klinesResponse = await this.http.get(klinesUrl);
    const klines = klinesResponse.data;

    // Fetch 24hr ticker for volume
    const tickerUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`;
    const tickerResponse = await this.http.get(tickerUrl);
    const ticker = tickerResponse.data;

    const candles = klines.map((k) => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      timestamp: k[0],
    }));

    this.enrichCandles(candles);
    const current = candles[candles.length - 1];

    const data = {
      symbol,
      open: current.open,
      high: current.high,
      low: current.low,
      close: current.close,
      volume: parseFloat(ticker.volume),
      candles,
      historical: candles.map((c) => c.close),
      indicators: this.calculateIndicators(candles),
      levels: this.calculateLevels(candles),
      timeframe,
    };

    this.cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  async fetchForexData(symbol, opts = {}) {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    const timeframe = opts.timeframe || "15m";
    const limit = opts.limit || 200;

    if (!apiKey) {
      const yahooData = await this.fetchYahooData(symbol, { timeframe, limit });
      return yahooData || this.getMockData(symbol, { timeframe, limit });
    }

    try {
      // TwelveData expects FX pairs like "EUR/USD" and metals like "XAU/USD"
      const symbolMap = {
        EURUSD: "EUR/USD",
        GBPUSD: "GBP/USD",
        USDJPY: "USD/JPY",
        XAUUSD: "XAU/USD",
      };
      const tdSymbol = symbolMap[symbol] || symbol;

      // Twelve Data interval examples: 1min, 5min, 15min, 30min, 45min, 1h, 4h, 1day
      const interval = timeframe
        .replace("m", "min")
        .replace("h", "h")
        .replace("d", "day");

      const url = "https://api.twelvedata.com/time_series";
      const params = {
        symbol: tdSymbol,
        interval,
        outputsize: Math.min(Math.max(limit, 50), 5000),
        format: "JSON",
        apikey: apiKey,
      };

      const resp = await this.http.get(url, { params });
      const payload = resp.data;
      if (!payload || payload.status === "error") {
        throw new Error(payload?.message || "TwelveData error");
      }
      const values = payload.values;
      if (!Array.isArray(values) || values.length < 50) {
        throw new Error("Insufficient TwelveData candles");
      }

      // Values are newest-first; convert to oldest-first
      const candles = values
        .slice()
        .reverse()
        .map((v) => ({
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
          volume: v.volume ? parseFloat(v.volume) : 0,
          timestamp: new Date(v.datetime).getTime(),
        }))
        .filter((c) => Number.isFinite(c.close));

      this.enrichCandles(candles);
      const current = candles[candles.length - 1];

      const data = {
        symbol,
        open: current.open,
        high: current.high,
        low: current.low,
        close: current.close,
        volume: current.volume || 0,
        candles,
        historical: candles.map((c) => c.close),
        indicators: this.calculateIndicators(candles),
        levels: this.calculateLevels(candles),
        timeframe,
        provider: "twelvedata",
      };

      this.cache.set(`${symbol}:${timeframe}:${limit}`, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      logger.warn(`TwelveData failed for ${symbol}, trying Yahoo fallback: ${error?.message || error}`);
      const yahooData = await this.fetchYahooData(symbol, { timeframe, limit });
      return yahooData || this.getMockData(symbol, { timeframe, limit });
    }
  }

  async fetchYahooData(symbol, opts = {}) {
    const yahooSymbolMap = {
      XAUUSD: "GC=F",
      GBPUSD: "GBPUSD=X",
      EURUSD: "EURUSD=X",
      USDJPY: "JPY=X",
      USOIL: "CL=F",
      NAS100: "NQ=F",
      SPX500: "ES=F",
      ETHUSD: "ETH-USD",
      BTCUSD: "BTC-USD",
    };
    const timeframe = opts.timeframe || "15m";
    const limit = opts.limit || 200;
    const cacheKey = `${symbol}:${timeframe}:${limit}`;
    const yahooSymbol = yahooSymbolMap[symbol];

    if (!yahooSymbol) {
      return null;
    }

    const intervalMap = {
      "1m": "1m",
      "5m": "5m",
      "15m": "15m",
      "30m": "30m",
      "1h": "60m",
      "4h": "1h",
      "1d": "1d",
      "D": "1d",
    };
    const interval = intervalMap[timeframe] || "15m";

    const range =
      interval === "1m" ? "7d" :
      interval === "5m" ? "30d" :
      interval === "15m" ? "60d" :
      interval === "30m" ? "60d" :
      interval === "60m" ? "730d" :
      "2y";

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
      const resp = await this.http.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });
      const result = resp.data?.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      const timestamps = result?.timestamp;

      if (!result || !quote || !Array.isArray(timestamps) || timestamps.length < 50) {
        throw new Error("Insufficient Yahoo candles");
      }

      const candles = timestamps
        .map((ts, index) => ({
          open: Number(quote.open?.[index]),
          high: Number(quote.high?.[index]),
          low: Number(quote.low?.[index]),
          close: Number(quote.close?.[index]),
          volume: Number(quote.volume?.[index] || 0),
          timestamp: Number(ts) * 1000,
        }))
        .filter((c) =>
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close)
        )
        .slice(-limit);

      if (candles.length < 50) {
        throw new Error("Yahoo returned too few clean candles");
      }

      this.enrichCandles(candles);
      const current = candles[candles.length - 1];
      const data = {
        symbol,
        open: current.open,
        high: current.high,
        low: current.low,
        close: current.close,
        volume: current.volume || 0,
        candles,
        historical: candles.map((c) => c.close),
        indicators: this.calculateIndicators(candles),
        levels: this.calculateLevels(candles),
        timeframe,
        provider: "yahoo",
      };

      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      logger.warn(`Yahoo fallback failed for ${symbol}: ${error?.message || error}`);
      return null;
    }
  }

  getMockData(symbol, opts = {}) {
    const basePrices = {
      XAUUSD: 2350.5,
      GBPUSD: 1.265,
      EURUSD: 1.085,
      USDJPY: 151.5,
      BTCUSD: 68000,
      ETHUSD: 3400,
      USOIL: 80,
      NAS100: 18500,
      SPX500: 5200,
    };
    const timeframe = opts.timeframe || "15m";
    const limit = opts.limit || 50;

    const basePrice = basePrices[symbol] || 100;
    const volatility = basePrice * 0.002; // 0.2% volatility

    // Generate realistic OHLC
    const change = (Math.random() - 0.5) * volatility;
    const close = basePrice + change;
    const high = close + Math.random() * volatility * 0.5;
    const low = close - Math.random() * volatility * 0.5;
    const open = close - change + (Math.random() - 0.5) * volatility * 0.3;

    const candles = [];
    for (let i = 0; i < limit; i++) {
      const c = basePrice + (Math.random() - 0.5) * volatility * 5;
      candles.push({
        open: c - volatility * 0.2,
        high: c + volatility * 0.3,
        low: c - volatility * 0.3,
        close: c,
        volume: 1000 + Math.random() * 5000,
        timestamp: Date.now() - (limit - i) * 15 * 60 * 1000,
      });
    }

    this.enrichCandles(candles);
    const data = {
      symbol,
      open,
      high,
      low,
      close,
      volume: 10000 + Math.random() * 50000,
      candles,
      historical: candles.map((c) => c.close),
      indicators: this.calculateIndicators(candles),
      levels: this.calculateLevels(candles),
      timeframe,
      provider: "mock",
    };

    this.cache.set(`${symbol}:${timeframe}:${limit}`, { data, timestamp: Date.now() });
    return data;
  }

  calculateIndicators(candles) {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    return {
      rsi: {
        14: this.calculateRSI(closes, 14),
      },
      ema: {
        20: this.calculateEMA(closes, 20),
        50: this.calculateEMA(closes, 50),
        200: this.calculateEMA(closes, 200),
      },
      atr: {
        14: this.calculateATR(highs, lows, closes, 14),
      },
      avgVolume: {
        20: this.calculateSMA(candles.map((c) => c.volume), 20),
      },
    };
  }

  calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[prices.length - i] - prices[prices.length - i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  calculateATR(highs, lows, closes, period) {
    if (highs.length < period + 1) return 0;

    let atr = 0;
    for (let i = highs.length - period; i < highs.length; i++) {
      const tr1 = highs[i] - lows[i];
      const tr2 = Math.abs(highs[i] - closes[i - 1]);
      const tr3 = Math.abs(lows[i] - closes[i - 1]);
      atr += Math.max(tr1, tr2, tr3);
    }

    return atr / period;
  }

  calculateSMA(values, period) {
    if (values.length < period) return values[values.length - 1];
    const sum = values.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  calculateLevels(candles) {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    return {
      resistance: Math.max(...highs.slice(-20)),
      support: Math.min(...lows.slice(-20)),
    };
  }
}
