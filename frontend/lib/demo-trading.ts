import { BACKTEST_TIMEFRAMES, TRADING_ASSETS, getTradingAsset } from "@/lib/assets";
import { fetchYahooCandles } from "@/lib/market-data";
import type { Candle } from "@/lib/smc-engine";
import type { StrategyCatalogItem } from "@/lib/strategy-catalog";

export type DemoOrderStatus = "OPEN" | "TP" | "SL" | "CLOSED";
export type DemoOrderSide = "BUY" | "SELL";

export type DemoOrderRow = {
  id: string;
  user_id: string;
  asset_id: string;
  trading_view_symbol: string | null;
  side: DemoOrderSide;
  entry: number;
  stop_loss: number;
  take_profit: number;
  size: number;
  status: DemoOrderStatus;
  source: "manual" | "agent" | "agent-cron";
  strategy_id: string | null;
  strategy_name: string | null;
  confidence: number | null;
  reason: string | null;
  opened_at: string;
  closed_at: string | null;
  exit_price: number | null;
  pnl: number | null;
};

export type DemoMarketSnapshot = {
  assetId: string;
  timeframe: string;
  latest: null | {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  dayChange: number;
  dayChangePct: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  ema20: number;
  ema50: number;
  atr: number;
  candles: Candle[];
};

export type DemoDecision = {
  decision: "BUY" | "SELL" | "WAIT";
  confidence: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  bias: string;
  summary: string;
  reasons: string[];
  invalidation: string;
};

type SupabaseLike = {
  from: (table: string) => any;
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function ema(values: number[], period: number) {
  if (!values.length) return 0;
  const multiplier = 2 / (period + 1);
  return values.reduce((previous, value, index) => {
    if (index === 0) return value;
    return value * multiplier + previous * (1 - multiplier);
  }, values[0]);
}

function atr(candles: Candle[], period = 14) {
  const sample = candles.slice(-period - 1);
  if (sample.length < 2) return 0;
  const ranges = sample.slice(1).map((candle, index) => {
    const previousClose = sample[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  return average(ranges);
}

export function snapshotFromCandles(assetId: string, timeframe: string, candles: Candle[]): DemoMarketSnapshot {
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes.slice(-60), 20);
  const ema50 = ema(closes.slice(-100), 50);
  const trend = ema20 > ema50 ? "BULLISH" : ema20 < ema50 ? "BEARISH" : "NEUTRAL";
  const dayChange = latest && previous ? latest.close - previous.close : 0;
  const dayChangePct = latest && previous && previous.close ? (dayChange / previous.close) * 100 : 0;

  return {
    assetId,
    timeframe,
    latest: latest
      ? {
          time: latest.time,
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
          volume: latest.volume ?? 0,
        }
      : null,
    dayChange,
    dayChangePct,
    trend,
    ema20,
    ema50,
    atr: atr(candles),
    candles: candles.slice(-80),
  };
}

export async function fetchMarketSnapshot(assetId: string, timeframe = "1H") {
  const normalizedTimeframe = BACKTEST_TIMEFRAMES.some((item) => item.value === timeframe.toUpperCase())
    ? timeframe.toUpperCase()
    : "1H";
  const candles = await fetchYahooCandles({
    pair: assetId,
    timeframe: normalizedTimeframe,
    range: normalizedTimeframe === "1D" ? "1y" : "60d",
  });
  return snapshotFromCandles(assetId, normalizedTimeframe, candles);
}

export function orderPnl(order: Pick<DemoOrderRow, "entry" | "side" | "size">, exitPrice: number) {
  const direction = order.side === "BUY" ? 1 : -1;
  return Number(((exitPrice - Number(order.entry)) * direction * Number(order.size)).toFixed(2));
}

export function orderMargin(order: Pick<DemoOrderRow, "entry" | "size">) {
  return Number(Math.max(1, Math.abs(Number(order.entry) * Number(order.size)) * 0.01).toFixed(2));
}

export function evaluateDemoDecision(
  snapshot: DemoMarketSnapshot,
  strategy?: Pick<StrategyCatalogItem, "id" | "name" | "riskReward">
): DemoDecision {
  const close = Number(snapshot.latest?.close ?? 0);
  const volatility = close > 0 && snapshot.atr > 0 ? (snapshot.atr / close) * 100 : 0;
  const shouldBuy = snapshot.trend === "BULLISH" && snapshot.dayChangePct >= -0.2;
  const shouldSell = snapshot.trend === "BEARISH" && snapshot.dayChangePct <= 0.2;
  const decision = shouldBuy ? "BUY" : shouldSell ? "SELL" : "WAIT";
  const riskReward = Math.max(1.2, Number(strategy?.riskReward ?? 2));
  const stopDistance = snapshot.atr > 0 ? snapshot.atr * 1.4 : close * 0.004;
  const targetDistance = stopDistance * riskReward;
  const confidence =
    decision === "WAIT"
      ? 52
      : Math.min(88, Math.round(60 + Math.abs(snapshot.dayChangePct) * 8 + volatility * 2 + riskReward * 2));

  return {
    decision,
    confidence,
    entry: close || null,
    stopLoss:
      close && decision !== "WAIT"
        ? Number((decision === "SELL" ? close + stopDistance : close - stopDistance).toFixed(close > 20 ? 2 : 5))
        : null,
    takeProfit:
      close && decision !== "WAIT"
        ? Number((decision === "SELL" ? close - targetDistance : close + targetDistance).toFixed(close > 20 ? 2 : 5))
        : null,
    riskReward: decision === "WAIT" ? null : Number(riskReward.toFixed(2)),
    bias: snapshot.trend,
    summary:
      decision === "WAIT"
        ? "The demo engine is waiting for cleaner trend and volatility alignment."
        : `${strategy?.name ?? "OGFX demo engine"} detects ${snapshot.trend.toLowerCase()} structure with defined TP/SL.`,
    reasons: [
      `Trend state: ${snapshot.trend}`,
      `Latest change: ${snapshot.dayChangePct.toFixed(2)}%`,
      `ATR volatility: ${volatility.toFixed(2)}%`,
      strategy?.name ? `Strategy: ${strategy.name}` : "Strategy: OGFX SMC guardrails",
    ],
    invalidation: "Invalidate if price trades through the protected stop-loss side before continuation.",
  };
}

export async function ensureDemoAccount(client: SupabaseLike, userId: string) {
  const { data: existing, error: readError } = await client
    .from("demo_accounts")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) throw new Error(readError.message);
  if (existing) return existing;

  const { data, error } = await client
    .from("demo_accounts")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function ensureDemoSettings(client: SupabaseLike, userId: string) {
  const { data: existing, error: readError } = await client
    .from("demo_account_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) throw new Error(readError.message);
  if (existing) return existing;

  const { data, error } = await client
    .from("demo_account_settings")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function closeDemoOrder(
  client: SupabaseLike,
  order: DemoOrderRow,
  exitPrice: number,
  status: Exclude<DemoOrderStatus, "OPEN">
) {
  const pnl = orderPnl(order, exitPrice);
  const closedAt = new Date().toISOString();

  const { error: orderError } = await client
    .from("demo_orders")
    .update({
      status,
      exit_price: exitPrice,
      close_price: exitPrice,
      pnl,
      closed_at: closedAt,
      updated_at: closedAt,
    })
    .eq("id", order.id)
    .eq("user_id", order.user_id);

  if (orderError) throw new Error(orderError.message);

  const { data: account, error: accountError } = await client
    .from("demo_accounts")
    .select("*")
    .eq("user_id", order.user_id)
    .maybeSingle();

  if (accountError) throw new Error(accountError.message);
  if (account) {
    const balance = Number(account.balance ?? account.initial_balance ?? 10000) + pnl;
    const realizedPnl = Number(account.realized_pnl ?? 0) + pnl;
    await client
      .from("demo_accounts")
      .update({
        balance,
        equity: balance,
        free_margin: balance,
        realized_pnl: realizedPnl,
        updated_at: closedAt,
      })
      .eq("user_id", order.user_id);
  }

  return { pnl, closedAt };
}

export async function recalculateDemoAccount(
  client: SupabaseLike,
  userId: string,
  snapshots: Record<string, DemoMarketSnapshot> = {}
) {
  const account = await ensureDemoAccount(client, userId);
  const { data: openOrders, error } = await client
    .from("demo_orders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "OPEN");

  if (error) throw new Error(error.message);

  let margin = 0;
  let unrealizedPnl = 0;
  for (const order of (openOrders ?? []) as DemoOrderRow[]) {
    margin += orderMargin(order);
    const latest = snapshots[order.asset_id]?.latest?.close;
    if (latest) unrealizedPnl += orderPnl(order, latest);
  }

  const balance = Number(account.balance ?? account.initial_balance ?? 10000);
  const equity = Number((balance + unrealizedPnl).toFixed(2));
  const freeMargin = Number((equity - margin).toFixed(2));
  const marginLevel = margin > 0 ? Number(((equity / margin) * 100).toFixed(2)) : null;
  const updatedAt = new Date().toISOString();

  const { data, error: updateError } = await client
    .from("demo_accounts")
    .update({
      equity,
      free_margin: freeMargin,
      margin: Number(margin.toFixed(2)),
      margin_level: marginLevel,
      updated_at: updatedAt,
    })
    .eq("user_id", userId)
    .select("*")
    .single();

  if (updateError) throw new Error(updateError.message);
  await client
    .from("demo_account_settings")
    .upsert({
      user_id: userId,
      balance,
      equity,
      margin: Number(margin.toFixed(2)),
      free_margin: freeMargin,
      margin_level: marginLevel,
      updated_at: updatedAt,
    }, { onConflict: "user_id" });
  return data;
}

export async function syncUserOpenOrders(client: SupabaseLike, userId: string, timeframe = "1H") {
  await ensureDemoAccount(client, userId);
  const { data: openOrders, error } = await client
    .from("demo_orders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "OPEN");

  if (error) throw new Error(error.message);

  const assetIds = Array.from(new Set(((openOrders ?? []) as DemoOrderRow[]).map((order) => order.asset_id)));
  const snapshots: Record<string, DemoMarketSnapshot> = {};
  await Promise.all(
    assetIds.map(async (assetId) => {
      snapshots[assetId] = await fetchMarketSnapshot(assetId, timeframe);
    })
  );

  const closed: Array<{ id: string; status: string; pnl: number }> = [];
  for (const order of (openOrders ?? []) as DemoOrderRow[]) {
    const latestPrice = snapshots[order.asset_id]?.latest?.close;
    if (!latestPrice) continue;
    const hitTp = order.side === "BUY" ? latestPrice >= order.take_profit : latestPrice <= order.take_profit;
    const hitSl = order.side === "BUY" ? latestPrice <= order.stop_loss : latestPrice >= order.stop_loss;
    if (!hitTp && !hitSl) continue;

    const exitPrice = hitTp ? Number(order.take_profit) : Number(order.stop_loss);
    const result = await closeDemoOrder(client, order, exitPrice, hitTp ? "TP" : "SL");
    closed.push({ id: order.id, status: hitTp ? "TP" : "SL", pnl: result.pnl });
  }

  const account = await recalculateDemoAccount(client, userId, snapshots);
  return { account, snapshots, closed };
}

export function defaultWatchedAssets(value: unknown) {
  if (Array.isArray(value) && value.length) {
    return value.map(String).filter((assetId) => getTradingAsset(assetId));
  }
  return TRADING_ASSETS.slice(0, 5).map((asset) => asset.id);
}
