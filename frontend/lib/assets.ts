export type TradingAsset = {
  id: string;
  name: string;
  category: "Forex" | "Metals" | "Crypto" | "Energy" | "Indices";
  tradingViewSymbol: string;
  yahooSymbol: string;
  color: string;
  description: string;
};

export const TRADING_ASSETS = [
  {
    id: "XAUUSD",
    name: "Gold Spot",
    category: "Metals",
    tradingViewSymbol: "OANDA:XAUUSD",
    yahooSymbol: "GC=F",
    color: "#f7c948",
    description: "Gold futures proxy for SMC liquidity and session sweeps.",
  },
  {
    id: "EURUSD",
    name: "Euro / US Dollar",
    category: "Forex",
    tradingViewSymbol: "OANDA:EURUSD",
    yahooSymbol: "EURUSD=X",
    color: "#38bdf8",
    description: "Major FX pair with deep liquidity and clean intraday structure.",
  },
  {
    id: "GBPUSD",
    name: "Pound / US Dollar",
    category: "Forex",
    tradingViewSymbol: "OANDA:GBPUSD",
    yahooSymbol: "GBPUSD=X",
    color: "#2dd4bf",
    description: "London and New York volatility for displacement-led setups.",
  },
  {
    id: "USDJPY",
    name: "US Dollar / Yen",
    category: "Forex",
    tradingViewSymbol: "OANDA:USDJPY",
    yahooSymbol: "JPY=X",
    color: "#fb7185",
    description: "JPY major with strong session reactions around liquidity pools.",
  },
  {
    id: "BTCUSD",
    name: "Bitcoin",
    category: "Crypto",
    tradingViewSymbol: "BINANCE:BTCUSDT",
    yahooSymbol: "BTC-USD",
    color: "#f59e0b",
    description: "24/7 crypto structure for continuous sweep and retest models.",
  },
  {
    id: "ETHUSD",
    name: "Ethereum",
    category: "Crypto",
    tradingViewSymbol: "BINANCE:ETHUSDT",
    yahooSymbol: "ETH-USD",
    color: "#818cf8",
    description: "High-beta crypto pair for momentum and FVG-style continuation.",
  },
  {
    id: "USOIL",
    name: "US Oil",
    category: "Energy",
    tradingViewSymbol: "TVC:USOIL",
    yahooSymbol: "CL=F",
    color: "#f97316",
    description: "Crude oil futures proxy for commodity sweeps and macro sessions.",
  },
  {
    id: "NAS100",
    name: "Nasdaq 100",
    category: "Indices",
    tradingViewSymbol: "TVC:US100",
    yahooSymbol: "NQ=F",
    color: "#a78bfa",
    description: "Growth index futures proxy for New York open backtests.",
  },
  {
    id: "SPX500",
    name: "S&P 500",
    category: "Indices",
    tradingViewSymbol: "TVC:SPX",
    yahooSymbol: "ES=F",
    color: "#60a5fa",
    description: "Broad-market futures proxy for index structure and risk cycles.",
  },
] as const satisfies readonly TradingAsset[];

export const BACKTEST_TIMEFRAMES = [
  { label: "1H", value: "1H", tradingViewInterval: "60", description: "Intraday walk-forward" },
  { label: "4H", value: "4H", tradingViewInterval: "240", description: "Session structure" },
  { label: "1D", value: "1D", tradingViewInterval: "D", description: "Swing context" },
] as const;

export const LIVE_CHART_TIMEFRAMES = [
  { label: "1m", value: "1", description: "Scalping view" },
  { label: "5m", value: "5", description: "Micro structure" },
  { label: "15m", value: "15", description: "Execution map" },
  { label: "1h", value: "60", description: "Session bias" },
  { label: "4h", value: "240", description: "HTF context" },
  { label: "1D", value: "D", description: "Swing context" },
] as const;

export const TRADING_ASSET_IDS = TRADING_ASSETS.map((asset) => asset.id);

export function getTradingAsset(id: string) {
  const normalized = id.toUpperCase();
  return TRADING_ASSETS.find((asset) => asset.id === normalized);
}

export function groupTradingAssets() {
  return TRADING_ASSETS.reduce<Record<TradingAsset["category"], TradingAsset[]>>(
    (groups, asset) => {
      groups[asset.category].push(asset);
      return groups;
    },
    { Forex: [], Metals: [], Crypto: [], Energy: [], Indices: [] }
  );
}
