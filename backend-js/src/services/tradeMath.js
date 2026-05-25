const DEFAULT_SPEC = {
  contractSize: 1,
  defaultLeverage: 100,
  quoteCurrency: "USD",
};

export const TRADE_SYMBOL_SPECS = {
  XAUUSD: { contractSize: 100, defaultLeverage: 100, quoteCurrency: "USD" },
  EURUSD: { contractSize: 100000, defaultLeverage: 200, quoteCurrency: "USD" },
  GBPUSD: { contractSize: 100000, defaultLeverage: 200, quoteCurrency: "USD" },
  USDJPY: { contractSize: 100000, defaultLeverage: 200, quoteCurrency: "JPY" },
  BTCUSD: { contractSize: 1, defaultLeverage: 20, quoteCurrency: "USD" },
  ETHUSD: { contractSize: 1, defaultLeverage: 20, quoteCurrency: "USD" },
  USOIL: { contractSize: 1000, defaultLeverage: 50, quoteCurrency: "USD" },
  NAS100: { contractSize: 1, defaultLeverage: 100, quoteCurrency: "USD" },
  SPX500: { contractSize: 1, defaultLeverage: 100, quoteCurrency: "USD" },
};

export function tradeSpec(assetId) {
  return TRADE_SYMBOL_SPECS[String(assetId || "").toUpperCase()] ?? DEFAULT_SPEC;
}

export function normalizeLeverage(value, assetId) {
  const fallback = tradeSpec(assetId).defaultLeverage;
  const leverage = Number(value ?? fallback);
  if (!Number.isFinite(leverage)) return fallback;
  return Math.max(1, Math.min(2000, Math.round(leverage)));
}

export function notionalUsd({ assetId, entry, size }) {
  const spec = tradeSpec(assetId);
  const lots = Math.abs(Number(size || 0));
  const price = Math.abs(Number(entry || 0));
  if (!lots || !price) return 0;
  if (spec.quoteCurrency === "JPY") return spec.contractSize * lots;
  return price * spec.contractSize * lots;
}

export function orderMargin({ assetId, entry, size, leverage }) {
  const appliedLeverage = normalizeLeverage(leverage, assetId);
  return Number(Math.max(0, notionalUsd({ assetId, entry, size }) / appliedLeverage).toFixed(2));
}

export function orderPnl({ assetId, entry, side, size, exitPrice }) {
  const spec = tradeSpec(assetId);
  const entryPrice = Number(entry || 0);
  const closePrice = Number(exitPrice || 0);
  const lots = Number(size || 0);
  if (!entryPrice || !closePrice || !lots) return 0;
  const direction = String(side).toUpperCase() === "BUY" ? 1 : -1;
  const quotePnl = (closePrice - entryPrice) * direction * spec.contractSize * lots;
  const usdPnl = spec.quoteCurrency === "JPY" ? quotePnl / closePrice : quotePnl;
  return Number(usdPnl.toFixed(2));
}
