import { NextResponse, type NextRequest } from "next/server";
import { BACKTEST_TIMEFRAMES, TRADING_ASSET_IDS } from "@/lib/assets";
import { runWalkForwardBacktest } from "@/lib/backtester";
import { ensureDemoAccount } from "@/lib/demo-trading";
import { fetchYahooCandles } from "@/lib/market-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VALID_PAIRS: Set<string> = new Set(TRADING_ASSET_IDS);
const VALID_TIMEFRAMES: Set<string> = new Set(BACKTEST_TIMEFRAMES.map((timeframe) => timeframe.value));

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const pair = String(body?.pair ?? "").toUpperCase();
  const timeframe = String(body?.timeframe ?? "").toUpperCase();
  const startDate = String(body?.startDate ?? "");
  const endDate = String(body?.endDate ?? "");

  if (!VALID_PAIRS.has(pair) || !VALID_TIMEFRAMES.has(timeframe) || !startDate || !endDate) {
    return NextResponse.json({ error: "Invalid backtest request" }, { status: 400 });
  }

  const candles = await fetchYahooCandles({ pair, timeframe, startDate, endDate });
  if (candles.length < 80) {
    return NextResponse.json({ error: "Not enough historical candles for this range" }, { status: 422 });
  }

  const account = await ensureDemoAccount(supabase, user.id);
  const requestedBalance = Number(body?.initialBalance);
  const initialBalance = Number.isFinite(requestedBalance)
    ? requestedBalance
    : Number(account?.balance ?? account?.initial_balance ?? 10000);
  const result = runWalkForwardBacktest({ candles, pair, timeframe, initialBalance });
  const { data, error } = await supabase
    .from("backtests")
    .insert({
      user_id: user.id,
      pair,
      timeframe,
      start_date: startDate,
      end_date: endDate,
      total_trades: result.summary.totalTrades,
      win_rate: result.summary.winRate,
      profit_factor: result.summary.profitFactor,
      max_drawdown: result.summary.maxDrawdown,
      final_balance: result.summary.finalBalance,
      sharpe_ratio: result.summary.sharpeRatio,
      equity_curve: result.equityCurve,
      trade_log: result.tradeLog,
      strategy_id: body?.strategyId ? String(body.strategyId) : null,
      strategy_name: body?.strategyName ? String(body.strategyName) : "OGFX SMC Engine",
      source: "manual",
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    backtestId: data.id,
    summary: result.summary,
    equityCurve: result.equityCurve,
    tradeLog: result.tradeLog,
  });
}
