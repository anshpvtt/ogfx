export type RiskMode = "conservative" | "moderate" | "aggressive";

export type CoinMeta = {
  id: string;
  symbol: string;
  name: string;
  tradingViewSymbol: string;
  liquidityRank: number;
};

export type CoinMarket = CoinMeta & {
  price: number;
  change24h: number;
  marketCap?: number;
  volume24h?: number;
  lastUpdatedAt: number;
};

export type ExchangeName = "Binance" | "Coinbase" | "Kraken" | "OKX" | "Bybit";

export type ExchangePrice = {
  coin: string;
  coinId: string;
  exchange: ExchangeName;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
};

export type CryptoPriceFeed = {
  markets: CoinMarket[];
  exchangePrices: ExchangePrice[];
  source: "coingecko" | "fallback";
  fetchedAt: number;
  warning?: string;
};

export type ArbOpportunity = {
  id: string;
  coin: string;
  coinId: string;
  buyExchange: ExchangeName;
  sellExchange: ExchangeName;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  spreadUSD: number;
  estimatedProfit: number;
  estimatedProfitPer1000: number;
  confidence: number;
  expiresInMs: number;
  timestamp: number;
};

export type BotConfig = {
  startingCapital: number;
  maxPositionSizePct: number;
  minSpreadPct: number;
  maxOpenTrades: number;
  targetCoins: string[];
  riskMode: RiskMode;
  stopLossEnabled: boolean;
  stopLossPct: number;
};

export type PaperTradeStatus = "open" | "closed" | "cancelled";

export type PaperTrade = {
  id: string;
  coin: string;
  coinId: string;
  buyExchange: ExchangeName;
  sellExchange: ExchangeName;
  entryTime: number;
  exitTime?: number;
  buyPrice: number;
  sellPrice: number;
  size: number;
  capitalUsed: number;
  grossSpreadPct: number;
  fees: number;
  pnl?: number;
  pnlPct?: number;
  status: PaperTradeStatus;
  reason: string;
};

export type PaperBotState = {
  isRunning: boolean;
  capital: number;
  startingCapital: number;
  trades: PaperTrade[];
  snapshots: Array<{ time: number; capital: number }>;
  lastTickAt: number;
};

export type PaperBotEvent =
  | { type: "opened"; trade: PaperTrade }
  | { type: "closed"; trade: PaperTrade }
  | { type: "snapshot"; capital: number; time: number };

export type Ticker = {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  timestamp: number;
};

export type OrderBook = {
  symbol: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  timestamp: number;
};

export type Order = {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
};

export type OrderResult = {
  id: string;
  status: "paper" | "rejected";
  filledPrice: number;
  filledSize: number;
  timestamp: number;
};

export type ExchangeAdapter = {
  name: ExchangeName;
  apiKey?: string;
  secret?: string;
  fetchTicker(symbol: string): Promise<Ticker>;
  fetchOrderBook(symbol: string): Promise<OrderBook>;
  placePaperOrder(order: Order): Promise<OrderResult>;
};
