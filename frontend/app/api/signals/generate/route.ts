import { NextResponse, type NextRequest } from "next/server";
import { BACKTEST_TIMEFRAMES, TRADING_ASSET_IDS } from "@/lib/assets";
import { snapshotFromCandles } from "@/lib/demo-trading";
import { fetchYahooCandles } from "@/lib/market-data";
import { runSmcEngine } from "@/lib/smc-engine";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VALID_PAIRS = new Set<string>(TRADING_ASSET_IDS);
const VALID_TIMEFRAMES = new Set<string>(BACKTEST_TIMEFRAMES.map((timeframe) => timeframe.value));

async function getPlan(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string) {
  const { data } = await supabase
    .from("subscriptions")
    .select("plan,status,current_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.plan ?? "free";
}

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
  const pair = String(body?.pair ?? "EURUSD").toUpperCase();
  const timeframeInput = String(body?.timeframe ?? "1H").toUpperCase();
  const timeframe = VALID_TIMEFRAMES.has(timeframeInput) ? timeframeInput : "1H";
  const plan = await getPlan(supabase, user.id);

  if (!VALID_PAIRS.has(pair)) {
    return NextResponse.json({ error: "Unknown asset" }, { status: 400 });
  }

  if (plan === "free") {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", monthStart.toISOString());

    if ((count ?? 0) >= 5) {
      return NextResponse.json({ error: "Free plan signal limit exceeded" }, { status: 403 });
    }
  }

  const candles = await fetchYahooCandles({ pair, timeframe, range: "6mo" });
  if (candles.length < 80) {
    return NextResponse.json({ error: "Not enough live candles" }, { status: 422 });
  }

  const analysis = runSmcEngine(candles.slice(-120), pair, timeframe);
  const snapshot = snapshotFromCandles(pair, timeframe, candles);
  const agentResponse = await fetch(new URL("/api/agent/analyze", request.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") ?? "",
    },
    cache: "no-store",
    body: JSON.stringify({
      assetId: pair,
      interval: timeframe,
      snapshot,
      strategyLogic: analysis,
      requireGemma: true,
    }),
  });
  const agentPayload = await agentResponse.json().catch(() => null);

  if (!agentResponse.ok) {
    return NextResponse.json(
      {
        error: agentPayload?.error || "Gemma signal generation failed",
        details: "Signals are configured to require Gemma with the OGFX strategy datasets.",
      },
      { status: agentResponse.status }
    );
  }

  const decision = agentPayload?.decision;
  const signal = decision?.decision === "BUY" || decision?.decision === "SELL" ? decision.decision : "NO_SETUP";
  const confidenceValue = Number(decision?.confidence ?? 0);
  const confidence = confidenceValue >= 75 ? "HIGH" : confidenceValue >= 55 ? "MEDIUM" : "LOW";
  const { data, error } = await supabase
    .from("signals")
    .insert({
      user_id: user.id,
      pair,
      timeframe,
      signal,
      bias: decision?.bias ?? analysis.signal.bias,
      entry: decision?.entry || null,
      stop_loss: decision?.stopLoss || null,
      take_profit: decision?.takeProfit || null,
      risk_reward: decision?.riskReward || null,
      confidence,
      confirmation_type: "GEMMA_OGFX_LOGIC",
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ...data, analysis, agent: decision });
}
