import { z } from "zod";
import { logger } from "../services/logger.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { backtestEngine } from "../engine/backtestEngine.js";
import { evaluateLsbrSetup } from "../engine/playbooks/lsbr.js";

const BacktestRequestSchema = z.object({
  pair: z.string().min(3),
  timeframe: z.enum(["1m", "5m", "15m", "1h"]).default("15m"),
  strategy: z.enum(["ELITE", "LSBR"]).default("ELITE"),
  limit: z.number().int().min(100).max(5000).default(500),
  initial_balance: z.number().positive().default(1000),
  min_confidence: z.number().int().min(0).max(100).default(85),
});

export async function backtestRoutes(fastify) {
  // Tiny endpoint to verify Supabase connectivity from Railway (service role)
  fastify.get("/backtest/health", async (_request, reply) => {
    try {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from("backtests").select("id").limit(1);
      if (error) {
        reply.status(500);
        return { ok: false, error: "Supabase query failed" };
      }
      return { ok: true };
    } catch (_e) {
      reply.status(500);
      return { ok: false, error: "Supabase env missing" };
    }
  });

  // Run backtest and persist to Supabase
  fastify.post("/backtest", async (request, reply) => {
    try {
      const parsed = BacktestRequestSchema.safeParse(request.body || {});
      if (!parsed.success) {
        reply.status(400);
        return { error: "Invalid body", details: parsed.error.flatten() };
      }

      const { pair, timeframe, strategy, limit, initial_balance, min_confidence } = parsed.data;

      const data = await fastify.signalEngine.marketData.fetchData(pair, {
        timeframe,
        limit,
      });

      const result = await backtestEngine({
        symbol: pair,
        timeframe,
        candles: data.candles,
        eliteEngine: fastify.signalEngine.eliteEngine,
        strategy,
        playbookResolver: evaluateLsbrSetup,
        initialBalance: initial_balance,
        minConfidence: min_confidence,
      });

      const supabase = getSupabaseAdmin();

      const insertBacktest = {
        strategy_name: result.strategy_name,
        pair: result.pair,
        timeframe: result.timeframe,
        initial_balance: result.initialBalance,
        final_balance: result.finalBalance,
        win_rate: result.metrics.winRate,
        total_trades: result.metrics.totalTrades,
        profit_factor: result.metrics.profitFactor,
        max_drawdown: result.metrics.maxDrawdown,
        average_rr: result.metrics.averageRR,
      };

      const { data: btRow, error: btErr } = await supabase
        .from("backtests")
        .insert(insertBacktest)
        .select("*")
        .single();

      if (btErr) {
        logger.error("Supabase insert backtest failed:", btErr);
        reply.status(500);
        return { error: "Failed to save backtest" };
      }

      const backtestId = btRow.id;

      if (result.trades.length) {
        const tradeRows = result.trades.map((t) => ({
          backtest_id: backtestId,
          type: t.type,
          entry: t.entry,
          sl: t.sl,
          tp: t.tp,
          result: t.result,
          pnl: t.pnl,
          balance: t.balance,
          confidence: t.confidence,
          rr: t.rr,
          reason: t.reason,
          candle_index: t.backtestIndex,
        }));

        const { error: trErr } = await supabase.from("backtest_trades").insert(tradeRows);
        if (trErr) {
          logger.error("Supabase insert trades failed:", trErr);
          // Keep backtest row; return partial success
        }
      }

      return {
        success: true,
        backtest: btRow,
        result,
        provider: data.provider,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Backtest error:", error);
      reply.status(500);
      return { error: "Backtest failed" };
    }
  });

  // List backtests
  fastify.get("/backtests", async (request, reply) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(request.query?.limit || 50)));
      const supabase = getSupabaseAdmin();

      const { data, error } = await supabase
        .from("backtests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        reply.status(500);
        return { error: "Failed to load backtests" };
      }

      return { success: true, backtests: data || [] };
    } catch (error) {
      logger.error("List backtests error:", error);
      reply.status(500);
      return { error: "Failed to load backtests" };
    }
  });

  // Get trades for a backtest
  fastify.get("/backtests/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      const supabase = getSupabaseAdmin();

      const { data: bt, error: btErr } = await supabase
        .from("backtests")
        .select("*")
        .eq("id", id)
        .single();

      if (btErr || !bt) {
        reply.status(404);
        return { error: "Backtest not found" };
      }

      const { data: trades, error: trErr } = await supabase
        .from("backtest_trades")
        .select("*")
        .eq("backtest_id", id)
        .order("created_at", { ascending: true });

      if (trErr) {
        reply.status(500);
        return { error: "Failed to load trades" };
      }

      return { success: true, backtest: bt, trades: trades || [] };
    } catch (error) {
      logger.error("Backtest detail error:", error);
      reply.status(500);
      return { error: "Failed to load backtest" };
    }
  });
}
