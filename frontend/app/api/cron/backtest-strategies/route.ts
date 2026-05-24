import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { BACKTEST_TIMEFRAMES, TRADING_ASSETS } from "@/lib/assets";
import { runWalkForwardBacktest } from "@/lib/backtester";
import { fetchYahooCandles } from "@/lib/market-data";
import { loadStrategyCatalog } from "@/lib/strategy-catalog";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function verifyCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  return Boolean(secret && header === `Bearer ${secret}`);
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const runGroupId = crypto.randomUUID();
  const { data: run } = await admin
    .from("strategy_cron_runs")
    .insert({ run_type: "strategy_backtest", status: "running", started_at: new Date().toISOString() })
    .select("id")
    .single();

  const completed: Array<{ strategyId: string; assetId: string; timeframe: string; trades: number }> = [];
  const failed: Array<{ strategyId: string; assetId: string; timeframe: string; error: string }> = [];

  try {
    const strategies = await loadStrategyCatalog();

    for (const asset of TRADING_ASSETS) {
      for (const timeframe of BACKTEST_TIMEFRAMES) {
        let candles = [];
        try {
          candles = await fetchYahooCandles({
            pair: asset.id,
            timeframe: timeframe.value,
            range: timeframe.value === "1D" ? "2y" : "180d",
          });
        } catch (error: any) {
          for (const strategy of strategies) {
            failed.push({
              strategyId: strategy.id,
              assetId: asset.id,
              timeframe: timeframe.value,
              error: error?.message || "Candle fetch failed",
            });
          }
          continue;
        }

        if (candles.length < 80) {
          for (const strategy of strategies) {
            failed.push({
              strategyId: strategy.id,
              assetId: asset.id,
              timeframe: timeframe.value,
              error: "Not enough historical candles",
            });
          }
          continue;
        }

        for (const strategy of strategies) {
          try {
            const result = runWalkForwardBacktest({
              candles,
              pair: asset.id,
              timeframe: timeframe.value,
              strategy,
            });

            const { error } = await admin.from("backtests").insert({
              user_id: null,
              pair: asset.id,
              timeframe: timeframe.value,
              start_date: candles[0]?.time ? candles[0].time.slice(0, 10) : null,
              end_date: candles.at(-1)?.time ? candles.at(-1)!.time.slice(0, 10) : null,
              total_trades: result.summary.totalTrades,
              win_rate: result.summary.winRate,
              profit_factor: result.summary.profitFactor,
              max_drawdown: result.summary.maxDrawdown,
              final_balance: result.summary.finalBalance,
              sharpe_ratio: result.summary.sharpeRatio,
              equity_curve: result.equityCurve,
              trade_log: result.tradeLog,
              strategy_id: strategy.id,
              strategy_name: strategy.name,
              source: "cron",
              run_group_id: runGroupId,
            });

            if (error) throw new Error(error.message);
            completed.push({
              strategyId: strategy.id,
              assetId: asset.id,
              timeframe: timeframe.value,
              trades: result.summary.totalTrades,
            });
          } catch (error: any) {
            failed.push({
              strategyId: strategy.id,
              assetId: asset.id,
              timeframe: timeframe.value,
              error: error?.message || "Backtest failed",
            });
          }
        }
      }
    }

    const summary = {
      runGroupId,
      strategies: strategies.length,
      completed: completed.length,
      failed: failed.length,
      samples: completed.slice(0, 10),
      failures: failed.slice(0, 10),
    };

    if (run?.id) {
      await admin
        .from("strategy_cron_runs")
        .update({
          status: failed.length ? "partial" : "success",
          finished_at: new Date().toISOString(),
          summary,
        })
        .eq("id", run.id);
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (error: any) {
    if (run?.id) {
      await admin
        .from("strategy_cron_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: error?.message || "Strategy backtest cron failed",
        })
        .eq("id", run.id);
    }

    return NextResponse.json({ error: error?.message || "Strategy backtest cron failed" }, { status: 500 });
  }
}
