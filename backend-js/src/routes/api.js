import { fetchYahooCandles, normalizeTimeframe } from "../services/yahooFeed.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { logger } from "../services/logger.js";
import { runSMCAnalysis, runSMCBacktest } from "../engine/smc/simpleSmc.js";
import { orderMargin as computeOrderMargin, orderPnl as computeOrderPnl } from "../services/tradeMath.js";

const SCAN_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "NAS100", "SPX500"];
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

function hasSupabaseEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function numeric(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function directionOf(row) {
  return row?.direction || row?.side || row?.signal || "BUY";
}

function symbolOf(row) {
  return row?.symbol || row?.asset_id || row?.pair || "XAUUSD";
}

function lotSizeOf(row) {
  return numeric(row?.lot_size, numeric(row?.size, 1));
}

function entryOf(row) {
  return numeric(row?.entry_price, numeric(row?.entry, 0));
}

function closePriceOf(row) {
  return numeric(row?.close_price, numeric(row?.exit_price, null));
}

function normalizeSignal(row) {
  const direction = directionOf(row);
  return {
    id: row.id,
    userId: row.user_id,
    symbol: symbolOf(row),
    pair: row.pair || symbolOf(row),
    direction,
    signal: row.signal || direction,
    timeframe: row.timeframe,
    entry: numeric(row.entry, numeric(row.entry_price, null)),
    stopLoss: numeric(row.stop_loss, null),
    takeProfit: numeric(row.take_profit, null),
    rrRatio: numeric(row.rr_ratio, numeric(row.risk_reward, null)),
    confidence: numeric(row.confidence, 0),
    strategy: row.strategy || row.strategy_name || "ELITE_SMC_GEMMA",
    status: row.status || "active",
    reason: row.reason || row.confirmation_type || "",
    createdAt: row.created_at,
    raw: row,
  };
}

function normalizeOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    symbol: symbolOf(row),
    direction: directionOf(row),
    lotSize: lotSizeOf(row),
    entry: entryOf(row),
    sl: numeric(row.stop_loss, null),
    tp: numeric(row.take_profit, null),
    status: String(row.status || "open").toLowerCase(),
    pnl: numeric(row.pnl, 0),
    openedAt: row.opened_at || row.created_at,
    closedAt: row.closed_at,
    closePrice: closePriceOf(row),
    raw: row,
  };
}

function orderMargin({ lotSize, entry, symbol, leverage }) {
  return computeOrderMargin({ assetId: symbol, entry, size: lotSize, leverage });
}

function orderPnl(order, closePrice) {
  return computeOrderPnl({
    assetId: symbolOf(order),
    entry: entryOf(order),
    side: directionOf(order),
    size: lotSizeOf(order),
    exitPrice: Number(closePrice),
  });
}

function fallbackAccount(userId, balance = 10000) {
  return {
    id: `demo-${userId || "guest"}`,
    user_id: userId || null,
    currency: "USD",
    initial_balance: balance,
    balance,
    equity: balance,
    free_margin: balance,
    margin: 0,
    margin_level: null,
    realized_pnl: 0,
    updated_at: new Date().toISOString(),
    nonPersistent: true,
  };
}

function fallbackDemoOrder(body) {
  const symbol = String(body.symbol || body.assetId || "XAUUSD").toUpperCase();
  const direction = String(body.direction || body.side || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
  const entry = numeric(body.entry, numeric(body.entry_price, 0));
  const lotSize = numeric(body.lotSize, numeric(body.size, 1));
  const sl = numeric(body.sl, numeric(body.stopLoss, numeric(body.stop_loss, null)));
  const tp = numeric(body.tp, numeric(body.takeProfit, numeric(body.take_profit, null)));

  return normalizeOrder({
    id: `demo-${Date.now()}`,
    user_id: body.userId || body.user_id || null,
    symbol,
    direction,
    lot_size: lotSize,
    entry_price: entry,
    stop_loss: sl,
    take_profit: tp,
    status: "open",
    pnl: 0,
    opened_at: new Date().toISOString(),
    source: body.source || "manual",
    confidence: numeric(body.confidence, null),
    reason: body.reason ? String(body.reason) : null,
  });
}

function parseGemmaJson(text) {
  const cleaned = String(text || "{}")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const normalizeParsed = (parsed) => Array.isArray(parsed) ? parsed[0] ?? {} : parsed;

  try {
    return normalizeParsed(JSON.parse(cleaned));
  } catch {
    const fenced = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    for (let index = fenced.length - 1; index >= 0; index -= 1) {
      try {
        return normalizeParsed(JSON.parse(fenced[index]?.[1]?.trim() || "{}"));
      } catch {
        // Keep searching below.
      }
    }

    const parsedObjects = [];
    for (let start = 0; start < cleaned.length; start += 1) {
      if (cleaned[start] !== "{") continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < cleaned.length; index += 1) {
        const char = cleaned[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === "\"") inString = false;
          continue;
        }
        if (char === "\"") inString = true;
        else if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            try {
              parsedObjects.push(normalizeParsed(JSON.parse(cleaned.slice(start, index + 1))));
              start = index;
            } catch {
              // Ignore non-JSON brace blocks in model commentary.
            }
            break;
          }
        }
      }
    }

    if (parsedObjects.length) {
      return parsedObjects[parsedObjects.length - 1];
    }
    throw new Error("Google AI returned non-JSON content");
  }
}

function friendlyAiError(error) {
  const message = String(error?.message || error || "AI provider unavailable");
  if (/unauthorized|401|403/i.test(message)) {
    return "AI provider rejected the API key. Check the server-side key value; OGFX local SMC fallback is active.";
  }
  if (/429|rate.?limit|temporarily|quota/i.test(message)) {
    return "AI provider is temporarily rate-limited. OGFX local SMC fallback is active.";
  }
  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

async function callGemmaConfirmation({ symbol, ohlcvData, analysis }) {
  if (!analysis.hasSetup) {
    return {
      confirmed: false,
      direction: "WAIT",
      confidence: Number(analysis.confidence || 0),
      reason: analysis.reason || "No local SMC setup; Google AI confirmation skipped.",
      entry: analysis.entry,
      sl: analysis.sl,
      tp: analysis.tp,
      model: "local-smc-precheck",
      provider: "local",
      fallback: true,
    };
  }

  const providerErrors = [];
  const key = process.env.GEMMA_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key) {
    return {
      confirmed: Boolean(analysis.hasSetup),
      direction: analysis.direction || "WAIT",
      confidence: Number(analysis.confidence || 0),
      reason: providerErrors[0] || "AI key is not configured; local SMC engine result used.",
      entry: analysis.entry,
      sl: analysis.sl,
      tp: analysis.tp,
      model: "local-smc-fallback",
      fallback: true,
    };
  }

  const model = (
    process.env.GEMMA_MODEL ||
    process.env.GEMINI_MODEL ||
    process.env.GOOGLE_GEMINI_MODEL ||
    "gemma-4-26b-a4b-it"
  ).replace(/^models\//, "");
  try {
    const response = await fetch(
      `${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: [
                "You are an elite SMC trading analyst for OGFX demo trading. Use ANFX LSBR and Shakuni trap logic. Do not claim certainty and do not provide financial advice.",
                "Use the strategy: liquidity sweep, BOS/MSS/CHOCH, displacement, order block/FVG/supply/demand retest, HTF bias, TP/SL discipline, and capital preservation.",
                "BUY only after sell-side liquidity sweep plus bullish structure confirmation. SELL only after buy-side liquidity sweep plus bearish structure confirmation. If unclear, return WAIT.",
                "Return JSON only with keys: confirmed, direction, confidence, reason, entry, sl, tp.",
                "Allowed direction values are BUY, SELL, WAIT. Confirm true only when confidence is at least 70 and TP/SL are valid.",
                `Symbol: ${symbol}`,
                `OHLCV data: ${JSON.stringify(ohlcvData.slice(-80))}`,
                `Local SMC engine result: ${JSON.stringify(analysis)}`,
              ].join("\n\n"),
            }],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 700, responseMimeType: "application/json" },
        }),
      }
    );

    const raw = await response.text();
    if (!response.ok) throw new Error(`Google AI returned ${response.status}: ${raw.slice(0, 220)}`);
    const payload = JSON.parse(raw || "{}");
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") ?? "{}";
    const parsed = parseGemmaJson(text);
    return {
      confirmed: Boolean(parsed.confirmed),
      direction: parsed.direction === "BUY" || parsed.direction === "SELL" ? parsed.direction : analysis.direction || "WAIT",
      confidence: Math.max(0, Math.min(100, numeric(parsed.confidence, analysis.confidence || 0))),
      reason: String(parsed.reason || analysis.reason || "SMC confluence check complete"),
      entry: numeric(parsed.entry, analysis.entry),
      sl: numeric(parsed.sl, analysis.sl),
      tp: numeric(parsed.tp, analysis.tp),
      model,
      provider: "gemini",
      fallback: false,
    };
  } catch (error) {
    providerErrors.push(friendlyAiError(error));
    return {
      confirmed: Boolean(analysis.hasSetup),
      direction: analysis.direction || "WAIT",
      confidence: Number(analysis.confidence || 0),
      reason: providerErrors[0] || "AI provider unavailable; local SMC engine result used.",
      entry: analysis.entry,
      sl: analysis.sl,
      tp: analysis.tp,
      model,
      provider: "gemini",
      fallback: true,
    };
  }
}

async function ensureAccount(supabase, userId) {
  const { data, error } = await supabase
    .from("demo_accounts")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from("demo_accounts")
    .insert({
      user_id: userId,
      balance: 10000,
      equity: 10000,
      free_margin: 10000,
      margin: 0,
    })
    .select("*")
    .single();
  if (insertError) throw new Error(insertError.message);
  return inserted;
}

async function recalculateAccount(supabase, userId) {
  const account = await ensureAccount(supabase, userId);
  const { data: orders, error } = await supabase
    .from("demo_orders")
    .select("*")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const openOrders = (orders || []).filter((order) => ["open", "pending", "OPEN", "PENDING"].includes(String(order.status)));
  const closedOrders = (orders || []).filter((order) => ["closed", "CLOSED", "TP", "SL"].includes(String(order.status)));
  const realized = closedOrders.reduce((sum, order) => sum + numeric(order.pnl, 0), 0);
  const { data: settings } = await supabase
    .from("demo_account_settings")
    .select("leverage")
    .eq("user_id", userId)
    .maybeSingle();
  const leverage = numeric(settings?.leverage, 100);
  const margin = openOrders.reduce((sum, order) => sum + orderMargin({
    lotSize: lotSizeOf(order),
    entry: entryOf(order),
    symbol: symbolOf(order),
    leverage,
  }), 0);
  const initial = numeric(account.initial_balance, 10000);
  const balance = Number((initial + realized).toFixed(2));
  const equity = balance;
  const freeMargin = Number((equity - margin).toFixed(2));

  const { data: updated, error: updateError } = await supabase
    .from("demo_accounts")
    .update({
      balance,
      equity,
      free_margin: freeMargin,
      margin: Number(margin.toFixed(2)),
      realized_pnl: realized,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);
  return updated;
}

async function insertSignal(supabase, { userId, symbol, timeframe, analysis, gemma, source = "GEMMA_SMC" }) {
  const direction = gemma.direction === "BUY" || gemma.direction === "SELL" ? gemma.direction : analysis.direction;
  const entry = numeric(gemma.entry, analysis.entry);
  const stopLoss = numeric(gemma.sl, analysis.sl);
  const takeProfit = numeric(gemma.tp, analysis.tp);
  const rr = entry && stopLoss && takeProfit ? Number((Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss)).toFixed(2)) : analysis.rr || 3;

  const row = {
    user_id: userId || null,
    symbol,
    pair: symbol,
    direction,
    signal: direction,
    timeframe,
    entry,
    entry_price: entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    rr_ratio: rr,
    risk_reward: rr,
    confidence: Math.round(gemma.confidence),
    strategy: "ELITE_SMC_GEMMA",
    strategy_name: "ELITE_SMC_GEMMA",
    status: "active",
    reason: gemma.reason,
    confirmation_type: source,
  };

  const { data, error } = await supabase.from("signals").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return normalizeSignal(data);
}

async function generateSignal({ symbol, timeframe = "1h", userId, minSaveConfidence = 70 }) {
  const candles = await fetchYahooCandles({ symbol, timeframe, limit: 320 });
  if (candles.length < 50) {
    const error = new Error("No data returned for this symbol/timeframe");
    error.statusCode = 404;
    throw error;
  }

  const analysis = runSMCAnalysis(candles, { symbol });
  const gemma = await callGemmaConfirmation({ symbol, ohlcvData: candles, analysis });
  const confirmed = Boolean(gemma.confirmed && ["BUY", "SELL"].includes(gemma.direction) && gemma.confidence >= minSaveConfidence);
  let savedSignal = null;

  if (confirmed && hasSupabaseEnv()) {
    const supabase = getSupabaseAdmin();
    savedSignal = await insertSignal(supabase, {
      userId,
      symbol,
      timeframe,
      analysis,
      gemma,
      source: gemma.fallback ? "SMC_LOCAL_FALLBACK" : "GEMMA_CONFIRMED",
    });
  }

  return {
    symbol,
    timeframe,
    provider: "yahoo-finance2",
    candles: candles.slice(-50),
    analysis,
    gemma,
    signal: savedSignal,
    confirmed,
    timestamp: new Date().toISOString(),
  };
}

async function placeDemoOrder(supabase, body) {
  const userId = String(body.userId || body.user_id || "");
  if (!userId) {
    const error = new Error("userId is required");
    error.statusCode = 400;
    throw error;
  }

  const symbol = String(body.symbol || body.assetId || "XAUUSD").toUpperCase();
  const direction = String(body.direction || body.side || "").toUpperCase();
  const lotSize = numeric(body.lotSize, numeric(body.size, 1));
  const entry = numeric(body.entry, numeric(body.entry_price, null));
  const sl = numeric(body.sl, numeric(body.stopLoss, numeric(body.stop_loss, null)));
  const tp = numeric(body.tp, numeric(body.takeProfit, numeric(body.take_profit, null)));

  if (!["BUY", "SELL"].includes(direction) || !entry || !sl || !tp || !lotSize) {
    const error = new Error("Invalid order fields");
    error.statusCode = 400;
    throw error;
  }

  const account = await ensureAccount(supabase, userId);
  const { data: settings } = await supabase
    .from("demo_account_settings")
    .select("leverage")
    .eq("user_id", userId)
    .maybeSingle();
  const margin = orderMargin({ lotSize, entry, symbol, leverage: numeric(settings?.leverage, 100) });
  if (numeric(account.free_margin, 0) < margin) {
    const error = new Error("Insufficient free margin");
    error.statusCode = 400;
    throw error;
  }

  const { data: order, error } = await supabase
    .from("demo_orders")
    .insert({
      user_id: userId,
      symbol,
      asset_id: symbol,
      direction,
      side: direction,
      lot_size: lotSize,
      size: lotSize,
      entry_price: entry,
      entry,
      stop_loss: sl,
      take_profit: tp,
      status: "open",
      source: body.source || "manual",
      confidence: numeric(body.confidence, null),
      reason: body.reason ? String(body.reason) : null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const updated = await recalculateAccount(supabase, userId);
  return { order: normalizeOrder(order), account: updated };
}

export async function apiRoutes(fastify) {
  fastify.post("/api/signal/generate", async (request, reply) => {
    try {
      const body = request.body || {};
      const symbol = String(body.symbol || "XAUUSD").toUpperCase();
      const timeframe = normalizeTimeframe(body.timeframe || "1h");
      const result = await generateSignal({ symbol, timeframe, userId: body.userId || body.user_id || null });
      return reply.header("Content-Type", "application/json").send({ success: true, ...result });
    } catch (error) {
      logger.error("Signal generation failed:", error);
      return reply.status(error.statusCode || 500).send({ success: false, error: error.message || "Signal generation failed" });
    }
  });

  fastify.get("/api/signals/:userId", async (request, reply) => {
    try {
      if (!hasSupabaseEnv()) return { success: true, signals: [], nonPersistent: true };
      const { userId } = request.params;
      const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 50)));
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("signals")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return { success: true, signals: (data || []).map(normalizeSignal) };
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message || "Failed to load signals" });
    }
  });

  fastify.post("/api/backtest/run", async (request, reply) => {
    try {
      const { symbol, timeframe = "1h", startDate, endDate, userId } = request.body || {};
      if (!symbol || !startDate || !endDate) {
        return reply.status(400).send({ success: false, error: "Missing required fields" });
      }

      const candles = await fetchYahooCandles({
        symbol: String(symbol).toUpperCase(),
        timeframe,
        startDate,
        endDate,
        limit: 0,
      });
      if (!candles.length) {
        return reply.status(404).send({ success: false, error: "No data returned for this symbol/range" });
      }
      if (candles.length < 80) {
        return reply.status(422).send({ success: false, error: "Not enough historical candles for this range" });
      }

      const result = runSMCBacktest(candles, { symbol: String(symbol).toUpperCase(), initialBalance: 10000 });
      let data = null;
      if (hasSupabaseEnv()) {
        const supabase = getSupabaseAdmin();
        const insert = await supabase
          .from("backtest_runs")
          .insert({
            user_id: userId || null,
            symbol: String(symbol).toUpperCase(),
            timeframe: normalizeTimeframe(timeframe),
            start_date: startDate,
            end_date: endDate,
            total_trades: result.totalTrades,
            win_rate: result.winRate,
            total_pnl: result.totalPnl,
            max_drawdown: result.maxDrawdown,
            result_json: result,
            status: "completed",
          })
          .select("*")
          .single();
        if (insert.error) throw new Error(insert.error.message);
        data = insert.data;
      }

      return reply.header("Content-Type", "application/json").send({
        success: true,
        backtestRun: data || { id: `local-${Date.now()}`, status: "completed", nonPersistent: true },
        result,
      });
    } catch (error) {
      logger.error("Backtest error:", error);
      return reply.status(500).send({ success: false, error: error.message || "Backtest failed" });
    }
  });

  fastify.get("/api/demo/account/:userId", async (request, reply) => {
    try {
      if (!hasSupabaseEnv()) return { success: true, account: fallbackAccount(request.params.userId) };
      const supabase = getSupabaseAdmin();
      const account = await recalculateAccount(supabase, request.params.userId);
      return { success: true, account };
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message || "Failed to load demo account" });
    }
  });

  fastify.post("/api/demo/account", async (request, reply) => {
    try {
      const userId = request.body?.userId || request.body?.user_id;
      if (!userId) return reply.status(400).send({ success: false, error: "userId is required" });
      if (!hasSupabaseEnv()) return { success: true, account: fallbackAccount(String(userId), numeric(request.body?.initialBalance, 10000)) };
      const account = await ensureAccount(getSupabaseAdmin(), String(userId));
      return { success: true, account };
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message || "Failed to create demo account" });
    }
  });

  fastify.get("/api/demo/orders/:userId", async (request, reply) => {
    try {
      if (!hasSupabaseEnv()) return { success: true, orders: [], nonPersistent: true };
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("demo_orders")
        .select("*")
        .eq("user_id", request.params.userId)
        .order("opened_at", { ascending: false });
      if (error) throw new Error(error.message);
      return { success: true, orders: (data || []).map(normalizeOrder) };
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message || "Failed to load demo orders" });
    }
  });

  fastify.post("/api/demo/place-order", async (request, reply) => {
    try {
      if (!hasSupabaseEnv()) {
        const order = fallbackDemoOrder(request.body || {});
        return { success: true, order, account: fallbackAccount(order.userId || request.body?.userId || request.body?.user_id) };
      }
      const { order, account } = await placeDemoOrder(getSupabaseAdmin(), request.body || {});
      return { success: true, order, account };
    } catch (error) {
      return reply.status(error.statusCode || 500).send({ success: false, error: error.message || "Failed to place order" });
    }
  });

  fastify.post("/api/demo/close-order", async (request, reply) => {
    try {
      const { orderId, userId, closePrice } = request.body || {};
      if (!orderId || !userId || !Number.isFinite(Number(closePrice))) {
        return reply.status(400).send({ success: false, error: "orderId, userId and closePrice are required" });
      }
      if (!hasSupabaseEnv()) return { success: true, order: { id: orderId, status: "closed", closePrice: Number(closePrice), nonPersistent: true }, account: fallbackAccount(userId) };

      const supabase = getSupabaseAdmin();
      const { data: order, error } = await supabase
        .from("demo_orders")
        .select("*")
        .eq("id", orderId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!order) return reply.status(404).send({ success: false, error: "Order not found" });

      const pnl = orderPnl(order, Number(closePrice));
      const { data: updatedOrder, error: updateError } = await supabase
        .from("demo_orders")
        .update({
          status: "closed",
          close_price: Number(closePrice),
          exit_price: Number(closePrice),
          pnl,
          closed_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .select("*")
        .single();
      if (updateError) throw new Error(updateError.message);

      const account = await recalculateAccount(supabase, userId);
      return { success: true, order: normalizeOrder(updatedOrder), account };
    } catch (error) {
      return reply.status(500).send({ success: false, error: error.message || "Failed to close order" });
    }
  });

  fastify.post("/api/cron/scan-market", async (request, reply) => {
    const configuredSecret = process.env.CRON_SECRET || process.env.AGENT_SECRET;
    const provided = request.headers["x-cron-secret"] || String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (configuredSecret && provided !== configuredSecret) {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }

    const summary = {
      checked: 0,
      savedSignals: 0,
      autoOrders: 0,
      results: [],
      errors: [],
    };

    try {
      const supabase = hasSupabaseEnv() ? getSupabaseAdmin() : null;
      let settings = [];
      if (supabase) {
        const { data: settingsData, error: settingsError } = await supabase
          .from("demo_account_settings")
          .select("*")
          .eq("auto_trading_enabled", true);
        if (settingsError && settingsError.code !== "PGRST116") throw new Error(settingsError.message);
        settings = settingsData || [];
      } else {
        summary.errors.push("Supabase env missing; persistence and auto orders skipped");
      }

      for (const symbol of SCAN_SYMBOLS) {
        try {
          const result = await generateSignal({ symbol, timeframe: "1h", userId: null, minSaveConfidence: 75 });
          summary.checked += 1;
          summary.results.push({ symbol, confirmed: result.confirmed, confidence: result.gemma?.confidence || 0 });
          if (result.signal) summary.savedSignals += 1;

          if (supabase && result.confirmed && result.gemma.confidence >= 75) {
            for (const setting of settings || []) {
              const watched = Array.isArray(setting.watched_assets) ? setting.watched_assets : [];
              if (watched.length && !watched.includes(symbol)) continue;
              await placeDemoOrder(supabase, {
                userId: setting.user_id,
                symbol,
                direction: result.gemma.direction,
                lotSize: numeric(setting.default_size, 1),
                entry: result.gemma.entry,
                sl: result.gemma.sl,
                tp: result.gemma.tp,
                source: "agent-cron",
                confidence: result.gemma.confidence,
                reason: result.gemma.reason,
              });
              summary.autoOrders += 1;
            }
          }
        } catch (error) {
          summary.errors.push(`${symbol}: ${error.message || error}`);
        }
      }

      logger.info("Cron market scan complete", summary);
      return { success: true, summary, timestamp: new Date().toISOString() };
    } catch (error) {
      logger.error("Cron market scan failed:", error);
      return reply.status(500).send({ success: false, error: error.message || "Cron scan failed", summary });
    }
  });
}
