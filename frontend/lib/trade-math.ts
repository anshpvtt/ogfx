export type TradeSide = "BUY" | "SELL";

type TradeSymbolSpec = {
  contractSize: number;
  defaultLeverage: number;
  minLot: number;
  lotStep: number;
  maxLot: number;
  pricePrecision: number;
  quoteCurrency: "USD" | "JPY";
};

const DEFAULT_SPEC: TradeSymbolSpec = {
  contractSize: 1,
  defaultLeverage: 100,
  minLot: 0.01,
  lotStep: 0.01,
  maxLot: 100,
  pricePrecision: 2,
  quoteCurrency: "USD",
};

export const TRADE_SYMBOL_SPECS: Record<string, TradeSymbolSpec> = {
  XAUUSD: { contractSize: 100, defaultLeverage: 100, minLot: 0.01, lotStep: 0.01, maxLot: 200, pricePrecision: 2, quoteCurrency: "USD" },
  EURUSD: { contractSize: 100000, defaultLeverage: 200, minLot: 0.01, lotStep: 0.01, maxLot: 100, pricePrecision: 5, quoteCurrency: "USD" },
  GBPUSD: { contractSize: 100000, defaultLeverage: 200, minLot: 0.01, lotStep: 0.01, maxLot: 100, pricePrecision: 5, quoteCurrency: "USD" },
  USDJPY: { contractSize: 100000, defaultLeverage: 200, minLot: 0.01, lotStep: 0.01, maxLot: 100, pricePrecision: 3, quoteCurrency: "JPY" },
  BTCUSD: { contractSize: 1, defaultLeverage: 20, minLot: 0.001, lotStep: 0.001, maxLot: 50, pricePrecision: 2, quoteCurrency: "USD" },
  ETHUSD: { contractSize: 1, defaultLeverage: 20, minLot: 0.01, lotStep: 0.01, maxLot: 500, pricePrecision: 2, quoteCurrency: "USD" },
  USOIL: { contractSize: 1000, defaultLeverage: 50, minLot: 0.01, lotStep: 0.01, maxLot: 500, pricePrecision: 3, quoteCurrency: "USD" },
  NAS100: { contractSize: 1, defaultLeverage: 100, minLot: 0.01, lotStep: 0.01, maxLot: 500, pricePrecision: 2, quoteCurrency: "USD" },
  SPX500: { contractSize: 1, defaultLeverage: 100, minLot: 0.01, lotStep: 0.01, maxLot: 500, pricePrecision: 2, quoteCurrency: "USD" },
};

export function getTradeSpec(assetId?: string | null) {
  return TRADE_SYMBOL_SPECS[String(assetId || "").toUpperCase()] ?? DEFAULT_SPEC;
}

export function normalizeLeverage(value: unknown, assetId?: string | null) {
  const fallback = getTradeSpec(assetId).defaultLeverage;
  const leverage = Number(value ?? fallback);
  if (!Number.isFinite(leverage)) return fallback;
  return Math.max(1, Math.min(2000, Math.round(leverage)));
}

export function roundPriceForAsset(assetId: string | null | undefined, value: number) {
  const precision = getTradeSpec(assetId).pricePrecision;
  return Number(value.toFixed(precision));
}

export function formatAssetPrice(assetId: string | null | undefined, value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(getTradeSpec(assetId).pricePrecision);
}

export function normalizeLotSize(assetId: string | null | undefined, value: unknown) {
  const spec = getTradeSpec(assetId);
  const amount = Number(value);
  if (!Number.isFinite(amount)) return spec.minLot;
  const stepped = Math.round(amount / spec.lotStep) * spec.lotStep;
  const precision = spec.lotStep < 0.01 ? 3 : 2;
  return Number(Math.max(spec.minLot, Math.min(spec.maxLot, stepped)).toFixed(precision));
}

export function notionalUsd({
  assetId,
  entry,
  size,
}: {
  assetId?: string | null;
  entry: number;
  size: number;
}) {
  const spec = getTradeSpec(assetId);
  const lots = Math.abs(Number(size || 0));
  const price = Math.abs(Number(entry || 0));
  if (!lots || !price) return 0;
  if (spec.quoteCurrency === "JPY") {
    return spec.contractSize * lots;
  }
  return price * spec.contractSize * lots;
}

export function orderMargin({
  assetId,
  entry,
  size,
  leverage,
}: {
  assetId?: string | null;
  entry: number;
  size: number;
  leverage?: number | null;
}) {
  const appliedLeverage = normalizeLeverage(leverage, assetId);
  return Number(Math.max(0, notionalUsd({ assetId, entry, size }) / appliedLeverage).toFixed(2));
}

export function orderPnl({
  assetId,
  entry,
  side,
  size,
  exitPrice,
}: {
  assetId?: string | null;
  entry: number;
  side: TradeSide;
  size: number;
  exitPrice: number;
}) {
  const spec = getTradeSpec(assetId);
  const entryPrice = Number(entry || 0);
  const closePrice = Number(exitPrice || 0);
  const lots = Number(size || 0);
  if (!entryPrice || !closePrice || !lots) return 0;
  const direction = side === "BUY" ? 1 : -1;
  const quotePnl = (closePrice - entryPrice) * direction * spec.contractSize * lots;
  const usdPnl = spec.quoteCurrency === "JPY" ? quotePnl / closePrice : quotePnl;
  return Number(usdPnl.toFixed(2));
}

export function orderRiskReward({
  assetId,
  entry,
  stopLoss,
  takeProfit,
  side,
  size,
}: {
  assetId?: string | null;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  side: TradeSide;
  size: number;
}) {
  const risk = Math.abs(orderPnl({ assetId, entry, side, size, exitPrice: stopLoss }));
  const reward = Math.abs(orderPnl({ assetId, entry, side, size, exitPrice: takeProfit }));
  return {
    risk,
    reward,
    rr: risk > 0 ? Number((reward / risk).toFixed(2)) : 0,
  };
}
