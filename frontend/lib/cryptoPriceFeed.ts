import type { CoinMarket, CoinMeta, CryptoPriceFeed, ExchangeAdapter, ExchangeName, ExchangePrice, Order, OrderBook, OrderResult, Ticker } from "@/lib/arbTypes";

export const COINS: CoinMeta[] = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", tradingViewSymbol: "BINANCE:BTCUSDT", liquidityRank: 100 },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", tradingViewSymbol: "BINANCE:ETHUSDT", liquidityRank: 96 },
  { id: "binancecoin", symbol: "BNB", name: "BNB", tradingViewSymbol: "BINANCE:BNBUSDT", liquidityRank: 88 },
  { id: "solana", symbol: "SOL", name: "Solana", tradingViewSymbol: "BINANCE:SOLUSDT", liquidityRank: 86 },
  { id: "ripple", symbol: "XRP", name: "XRP", tradingViewSymbol: "BINANCE:XRPUSDT", liquidityRank: 84 },
  { id: "cardano", symbol: "ADA", name: "Cardano", tradingViewSymbol: "BINANCE:ADAUSDT", liquidityRank: 78 },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche", tradingViewSymbol: "BINANCE:AVAXUSDT", liquidityRank: 76 },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin", tradingViewSymbol: "BINANCE:DOGEUSDT", liquidityRank: 74 },
  { id: "polkadot", symbol: "DOT", name: "Polkadot", tradingViewSymbol: "BINANCE:DOTUSDT", liquidityRank: 70 },
  { id: "chainlink", symbol: "LINK", name: "Chainlink", tradingViewSymbol: "BINANCE:LINKUSDT", liquidityRank: 72 },
  { id: "litecoin", symbol: "LTC", name: "Litecoin", tradingViewSymbol: "BINANCE:LTCUSDT", liquidityRank: 68 },
  { id: "uniswap", symbol: "UNI", name: "Uniswap", tradingViewSymbol: "BINANCE:UNIUSDT", liquidityRank: 62 },
  { id: "stellar", symbol: "XLM", name: "Stellar", tradingViewSymbol: "BINANCE:XLMUSDT", liquidityRank: 60 },
  { id: "monero", symbol: "XMR", name: "Monero", tradingViewSymbol: "KRAKEN:XMRUSD", liquidityRank: 56 },
  { id: "tron", symbol: "TRX", name: "TRON", tradingViewSymbol: "BINANCE:TRXUSDT", liquidityRank: 66 },
];

export const EXCHANGES_SIMULATED: ExchangeName[] = ["Binance", "Coinbase", "Kraken", "OKX", "Bybit"];

const FALLBACK_PRICES: Record<string, number> = {
  bitcoin: 67000,
  ethereum: 3400,
  binancecoin: 610,
  solana: 156,
  ripple: 0.58,
  cardano: 0.45,
  "avalanche-2": 36,
  dogecoin: 0.16,
  polkadot: 7.2,
  chainlink: 17,
  litecoin: 84,
  uniswap: 9.8,
  stellar: 0.11,
  monero: 168,
  tron: 0.12,
};

function hash(input: string) {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function seededRange(seed: string, min: number, max: number) {
  const ratio = hash(seed) / 0xffffffff;
  return min + (max - min) * ratio;
}

function normalizeMarket(coin: CoinMeta, payload: any, now: number): CoinMarket {
  const row = payload?.[coin.id] ?? {};
  const fallbackDrift = Math.sin(now / 60000 + coin.liquidityRank) * 0.008;
  const price = Number(row.usd ?? FALLBACK_PRICES[coin.id] * (1 + fallbackDrift));
  return {
    ...coin,
    price,
    change24h: Number(row.usd_24h_change ?? fallbackDrift * 100),
    marketCap: Number.isFinite(Number(row.usd_market_cap)) ? Number(row.usd_market_cap) : undefined,
    volume24h: Number.isFinite(Number(row.usd_24h_vol)) ? Number(row.usd_24h_vol) : undefined,
    lastUpdatedAt: Number(row.last_updated_at ?? Math.floor(now / 1000)),
  };
}

export function simulateExchangePrices(markets: CoinMarket[], now = Date.now()): ExchangePrice[] {
  const bucket = Math.floor(now / 10000);
  return markets.flatMap((market) =>
    EXCHANGES_SIMULATED.map((exchange, exchangeIndex) => {
      const deviation = seededRange(`${market.id}:${exchange}:${bucket}`, -0.003, 0.003);
      const microSpread = seededRange(`${exchange}:${market.id}:book:${bucket}`, 0.00008, 0.00028);
      const exchangeBias = (exchangeIndex - 2) * 0.00005;
      const price = market.price * (1 + deviation + exchangeBias);
      return {
        coin: market.symbol,
        coinId: market.id,
        exchange,
        price,
        bid: price * (1 - microSpread),
        ask: price * (1 + microSpread),
        spread: microSpread * 200,
        timestamp: now,
      };
    })
  );
}

function fallbackFeed(warning?: string): CryptoPriceFeed {
  const now = Date.now();
  const markets = COINS.map((coin) => normalizeMarket(coin, {}, now));
  return {
    markets,
    exchangePrices: simulateExchangePrices(markets, now),
    source: "fallback",
    fetchedAt: now,
    warning,
  };
}

export async function fetchCryptoPriceFeed(apiKey = process.env.COINGECKO_API_KEY || process.env.CG_DEMO_API_KEY || ""): Promise<CryptoPriceFeed> {
  const now = Date.now();
  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", COINS.map((coin) => coin.id).join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  url.searchParams.set("include_last_updated_at", "true");
  url.searchParams.set("include_market_cap", "true");
  url.searchParams.set("include_24hr_vol", "true");
  if (apiKey) url.searchParams.set("x_cg_demo_api_key", apiKey);

  try {
    const response = await fetch(url, {
      headers: apiKey ? { "x-cg-demo-api-key": apiKey } : undefined,
      next: { revalidate: 10 },
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`CoinGecko returned ${response.status}: ${raw.slice(0, 220)}`);
    const payload = JSON.parse(raw || "{}");
    const markets = COINS.map((coin) => normalizeMarket(coin, payload, now));
    return {
      markets,
      exchangePrices: simulateExchangePrices(markets, now),
      source: "coingecko",
      fetchedAt: now,
    };
  } catch (error: any) {
    return fallbackFeed(String(error?.message || error || "CoinGecko price feed unavailable"));
  }
}

export function simulateOrderBook(price: number, seed: string): OrderBook {
  const now = Date.now();
  const levels = Array.from({ length: 12 }, (_, index) => index + 1);
  return {
    symbol: seed,
    bids: levels.map((level) => ({
      price: price * (1 - level * 0.0006),
      size: seededRange(`${seed}:bid:${level}:${Math.floor(now / 10000)}`, 4, 42),
    })),
    asks: levels.map((level) => ({
      price: price * (1 + level * 0.0006),
      size: seededRange(`${seed}:ask:${level}:${Math.floor(now / 10000)}`, 4, 42),
    })),
    timestamp: now,
  };
}

class StubExchangeAdapter implements ExchangeAdapter {
  name: ExchangeName;
  apiKey?: string;
  secret?: string;

  constructor(name: ExchangeName, apiKey?: string, secret?: string) {
    this.name = name;
    this.apiKey = apiKey;
    this.secret = secret;
  }

  private assertConfigured() {
    if (!this.apiKey || !this.secret) {
      throw new Error(`${this.name} adapter is not configured. Paper simulation remains active.`);
    }
  }

  async fetchTicker(_symbol: string): Promise<Ticker> {
    this.assertConfigured();
    throw new Error(`${this.name} live ticker adapter is stubbed for Phase 2.`);
  }

  async fetchOrderBook(_symbol: string): Promise<OrderBook> {
    this.assertConfigured();
    throw new Error(`${this.name} live order book adapter is stubbed for Phase 2.`);
  }

  async placePaperOrder(order: Order): Promise<OrderResult> {
    return {
      id: `paper-${this.name.toLowerCase()}-${Date.now()}`,
      status: "paper",
      filledPrice: order.price,
      filledSize: order.size,
      timestamp: Date.now(),
    };
  }
}

export class BinanceAdapter extends StubExchangeAdapter {
  constructor() {
    super("Binance", process.env.BINANCE_API_KEY, process.env.BINANCE_API_SECRET);
  }
}

export class CoinbaseAdapter extends StubExchangeAdapter {
  constructor() {
    super("Coinbase", process.env.COINBASE_API_KEY, process.env.COINBASE_API_SECRET);
  }
}

export class KrakenAdapter extends StubExchangeAdapter {
  constructor() {
    super("Kraken", process.env.KRAKEN_API_KEY, process.env.KRAKEN_API_SECRET);
  }
}

export class OKXAdapter extends StubExchangeAdapter {
  constructor() {
    super("OKX", process.env.OKX_API_KEY, process.env.OKX_API_SECRET);
  }
}

export class BybitAdapter extends StubExchangeAdapter {
  constructor() {
    super("Bybit", process.env.BYBIT_API_KEY, process.env.BYBIT_API_SECRET);
  }
}
