import { GeminiAnalyzer } from "./geminiAnalyzer.js";
import { getSupabaseAdmin } from "./supabase.js";
import { logger } from "./logger.js";

const DEFAULT_ASSETS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "ETHUSD", "USOIL", "NAS100", "SPX500"];
const DEFAULT_TIMEFRAMES = ["15m", "1h"];

function csv(value, fallback) {
  const raw = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return raw.length ? raw : fallback;
}

function confidenceLabel(value) {
  const confidence = Number(value || 0);
  if (confidence >= 75) return "HIGH";
  if (confidence >= 55) return "MEDIUM";
  return "LOW";
}

function orderMargin({ entry, size }) {
  return Math.abs(Number(entry || 0) * Number(size || 1)) * 0.02;
}

function orderPnl(order, price) {
  const direction = order.side === "BUY" ? 1 : -1;
  return (Number(price) - Number(order.entry)) * direction * Number(order.size || 1);
}

function normalizedSignal(decision, assetId, timeframe, userId = null, confirmationType = "GEMINI_RENDER_AGENT") {
  return {
    user_id: userId,
    pair: assetId,
    timeframe,
    signal: decision.decision === "BUY" || decision.decision === "SELL" ? decision.decision : "NO_SETUP",
    bias: decision.bias,
    entry: decision.entry,
    stop_loss: decision.stopLoss,
    take_profit: decision.takeProfit,
    risk_reward: decision.riskReward,
    confidence: confidenceLabel(decision.confidence),
    confirmation_type: confirmationType,
  };
}

export class LiveTradingAgent {
  constructor(signalEngine) {
    this.signalEngine = signalEngine;
    this.gemini = new GeminiAnalyzer();
    this.intervalId = null;
    this.running = false;
    this.tickInFlight = false;
    this.lastSignals = new Map();
    this.state = {
      enabled: process.env.LIVE_AGENT_ENABLED !== "false",
      lastTickAt: null,
      lastError: null,
      lastSummary: null,
      ticks: 0,
      insertedSignals: 0,
      openedOrders: 0,
      closedOrders: 0,
    };
  }

  get intervalMs() {
    return Math.max(15, Number(process.env.LIVE_AGENT_INTERVAL_SECONDS || 60)) * 1000;
  }

  get minConfidence() {
    return Math.max(1, Math.min(100, Number(process.env.MIN_CONFIDENCE || 68)));
  }

  get assets() {
    return csv(process.env.LIVE_AGENT_ASSETS, DEFAULT_ASSETS);
  }

  get timeframes() {
    return csv(process.env.LIVE_AGENT_TIMEFRAMES, DEFAULT_TIMEFRAMES);
  }

  supabase() {
    return getSupabaseAdmin();
  }

  start() {
    if (!this.state.enabled || this.running) return;
    this.running = true;
    logger.info(`Live trading agent starting: ${this.assets.join(", ")} / ${this.timeframes.join(", ")}`);

    this.tick().catch((error) => logger.error("Initial live agent tick failed:", error));
    this.intervalId = setInterval(() => {
      this.tick().catch((error) => logger.error("Live agent tick failed:", error));
    }, this.intervalMs);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.running = false;
  }

  status() {
    return {
      ...this.state,
      running: this.running,
      intervalSeconds: this.intervalMs / 1000,
      assets: this.assets,
      timeframes: this.timeframes,
      minConfidence: this.minConfidence,
    };
  }

  shouldSkipDuplicate(assetId, timeframe, decision) {
    const key = `${assetId}:${timeframe}:${decision.decision}`;
    const last = this.lastSignals.get(key);
    const minGapMs = Math.max(5, Number(process.env.LIVE_AGENT_SIGNAL_GAP_MINUTES || 15)) * 60 * 1000;
    if (last && Date.now() - last < minGapMs) return true;
    this.lastSignals.set(key, Date.now());
    return false;
  }

  async tick() {
    if (this.tickInFlight) return { skipped: true, reason: "tick already running" };
    this.tickInFlight = true;

    const summary = {
      checked: 0,
      insertedSignals: 0,
      openedOrders: 0,
      closedOrders: 0,
      errors: [],
    };

    try {
      const supabase = this.supabase();
      summary.closedOrders += await this.syncOpenOrders(supabase);

      const { data: settings, error: settingsError } = await supabase
        .from("demo_account_settings")
        .select("*")
        .eq("auto_trading_enabled", true);

      if (settingsError && settingsError.code !== "PGRST116") throw new Error(settingsError.message);
      const enabledSettings = Array.isArray(settings) ? settings : [];

      for (const assetId of this.assets) {
        for (const timeframe of this.timeframes) {
          try {
            const result = await this.analyzeMarket(assetId, timeframe);
            summary.checked += 1;

            if (!result?.decision || this.shouldSkipDuplicate(assetId, timeframe, result.decision)) continue;
            const affected = await this.persistDecision(supabase, result, enabledSettings);
            summary.insertedSignals += affected.insertedSignals;
            summary.openedOrders += affected.openedOrders;
          } catch (error) {
            summary.errors.push(`${assetId}/${timeframe}: ${error?.message || error}`);
          }
        }
      }

      this.state.ticks += 1;
      this.state.lastTickAt = new Date().toISOString();
      this.state.lastError = summary.errors[0] || null;
      this.state.lastSummary = summary;
      this.state.insertedSignals += summary.insertedSignals;
      this.state.openedOrders += summary.openedOrders;
      this.state.closedOrders += summary.closedOrders;

      return summary;
    } finally {
      this.tickInFlight = false;
    }
  }

  async analyzeMarket(assetId, timeframe = "15m") {
    const market = await this.signalEngine.marketData.fetchData(assetId, {
      timeframe,
      limit: 260,
    });
    const snapshot = this.gemini.snapshotFromMarket(assetId, timeframe, market);
    const engineResult = await this.signalEngine.analyzeSymbol(assetId, { timeframe });
    const decision = await this.gemini.analyze({
      assetId,
      timeframe,
      snapshot,
      engineResult,
    });

    return {
      assetId,
      timeframe,
      snapshot,
      engineResult,
      decision,
    };
  }

  async persistDecision(supabase, result, settings) {
    const { assetId, timeframe, decision } = result;
    const response = { insertedSignals: 0, openedOrders: 0 };
    const watchedSettings = settings.filter((setting) => {
      const watched = Array.isArray(setting.watched_assets) ? setting.watched_assets : [];
      return watched.length === 0 || watched.includes(assetId);
    });

    if (!watchedSettings.length) {
      const { error } = await supabase.from("signals").insert(normalizedSignal(decision, assetId, timeframe));
      if (error) throw new Error(error.message);
      response.insertedSignals += 1;
      return response;
    }

    for (const setting of watchedSettings) {
      const { error } = await supabase
        .from("signals")
        .insert(normalizedSignal(decision, assetId, timeframe, setting.user_id));
      if (error) throw new Error(error.message);
      response.insertedSignals += 1;

      if (await this.maybeOpenDemoOrder(supabase, setting, result)) {
        response.openedOrders += 1;
      }
    }

    return response;
  }

  async maybeOpenDemoOrder(supabase, setting, result) {
    const { assetId, decision } = result;
    if (
      !(decision.decision === "BUY" || decision.decision === "SELL") ||
      decision.confidence < this.minConfidence ||
      !decision.entry ||
      !decision.stopLoss ||
      !decision.takeProfit
    ) {
      return false;
    }

    const { data: openOrders, error: openError } = await supabase
      .from("demo_orders")
      .select("*")
      .eq("user_id", setting.user_id)
      .eq("status", "OPEN");
    if (openError) throw new Error(openError.message);

    const maxOpen = Number(setting.max_open_trades ?? 5);
    if ((openOrders ?? []).length >= maxOpen) return false;
    if ((openOrders ?? []).some((order) => order.asset_id === assetId)) return false;

    const account = await this.ensureAccount(supabase, setting.user_id);
    const size = Number(setting.default_size ?? 1);
    const margin = orderMargin({ entry: decision.entry, size });
    if (Number(account.free_margin ?? account.balance ?? 0) < margin) return false;

    const { error } = await supabase.from("demo_orders").insert({
      user_id: setting.user_id,
      asset_id: assetId,
      side: decision.decision,
      entry: decision.entry,
      stop_loss: decision.stopLoss,
      take_profit: decision.takeProfit,
      size,
      status: "OPEN",
      source: "agent-cron",
      confidence: decision.confidence,
      reason: decision.summary,
    });
    if (error) throw new Error(error.message);

    await this.recalculateAccount(supabase, setting.user_id);
    return true;
  }

  async ensureAccount(supabase, userId) {
    const { data, error } = await supabase
      .from("demo_accounts")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;

    const { data: inserted, error: insertError } = await supabase
      .from("demo_accounts")
      .insert({ user_id: userId })
      .select("*")
      .single();
    if (insertError) throw new Error(insertError.message);
    return inserted;
  }

  async syncOpenOrders(supabase) {
    const { data: orders, error } = await supabase.from("demo_orders").select("*").eq("status", "OPEN");
    if (error) throw new Error(error.message);

    const byUser = new Set();
    let closed = 0;
    for (const order of orders ?? []) {
      const market = await this.signalEngine.marketData.fetchData(order.asset_id, { timeframe: "15m", limit: 80 });
      const price = Number(market.close);
      const hitTp = order.side === "BUY" ? price >= Number(order.take_profit) : price <= Number(order.take_profit);
      const hitSl = order.side === "BUY" ? price <= Number(order.stop_loss) : price >= Number(order.stop_loss);
      if (!hitTp && !hitSl) continue;

      const exitPrice = hitTp ? Number(order.take_profit) : Number(order.stop_loss);
      const { error: updateError } = await supabase
        .from("demo_orders")
        .update({
          status: hitTp ? "TP" : "SL",
          exit_price: exitPrice,
          pnl: orderPnl(order, exitPrice),
          closed_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      if (updateError) throw new Error(updateError.message);
      byUser.add(order.user_id);
      closed += 1;
    }

    for (const userId of byUser) await this.recalculateAccount(supabase, userId);
    return closed;
  }

  async recalculateAccount(supabase, userId) {
    const { data: account, error: accountError } = await supabase
      .from("demo_accounts")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (accountError) throw new Error(accountError.message);
    if (!account) return null;

    const { data: orders, error: ordersError } = await supabase
      .from("demo_orders")
      .select("*")
      .eq("user_id", userId);
    if (ordersError) throw new Error(ordersError.message);

    let realizedPnl = 0;
    let floatingPnl = 0;
    let margin = 0;
    for (const order of orders ?? []) {
      if (order.status === "OPEN") {
        const market = await this.signalEngine.marketData.fetchData(order.asset_id, { timeframe: "15m", limit: 80 });
        floatingPnl += orderPnl(order, Number(market.close));
        margin += orderMargin({ entry: order.entry, size: order.size });
      } else {
        realizedPnl += Number(order.pnl ?? 0);
      }
    }

    const initial = Number(account.initial_balance ?? 10000);
    const balance = initial + realizedPnl;
    const equity = balance + floatingPnl;
    const freeMargin = equity - margin;
    const marginLevel = margin > 0 ? (equity / margin) * 100 : null;
    const { data: updated, error: updateError } = await supabase
      .from("demo_accounts")
      .update({
        balance,
        equity,
        free_margin: freeMargin,
        margin,
        margin_level: marginLevel,
        realized_pnl: realizedPnl,
      })
      .eq("user_id", userId)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);
    return updated;
  }
}
