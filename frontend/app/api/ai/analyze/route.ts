import { NextResponse, type NextRequest } from "next/server";
import { TRADING_ASSET_IDS, getTradingAsset } from "@/lib/assets";
import { callGemmaAnalysis, friendlyAiError, normalizeSmcAnalysis } from "@/lib/ai/gemma";
import { smcAnalysisPrompt } from "@/lib/ai/prompts";
import { snapshotFromCandles } from "@/lib/demo-trading";
import { fetchYahooCandles } from "@/lib/market-data";
import { runSmcEngine } from "@/lib/smc-engine";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_PAIRS = new Set<string>(TRADING_ASSET_IDS);
const VALID_TIMEFRAMES = new Set(["1M", "5M", "15M", "1H", "4H", "1D", "1", "5", "15", "60", "240", "D"]);

function normalizeTimeframe(value: unknown) {
  const raw = String(value || "1H").toUpperCase();
  if (raw === "1" || raw === "1M") return "1H";
  if (raw === "5" || raw === "5M") return "1H";
  if (raw === "15" || raw === "15M") return "1H";
  if (raw === "60") return "1H";
  if (raw === "240") return "4H";
  if (raw === "D") return "1D";
  return VALID_TIMEFRAMES.has(raw) ? raw : "1H";
}

function localFallback(pair: string, timeframe: string, smc: any, snapshot: any, warning: string) {
  const signal = smc?.signal ?? {};
  const bias = signal.signal === "BUY" || signal.signal === "SELL" ? signal.signal : "WAIT";
  const confidence = signal.confidence === "HIGH" ? 76 : signal.confidence === "MEDIUM" ? 63 : 48;
  return {
    ...normalizeSmcAnalysis({
      bias,
      confidence,
      entry: signal.entry || snapshot?.latest?.close,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      rr_ratio: signal.riskReward,
      setup_type: signal.entryConfirmation && signal.entryConfirmation !== "NONE" ? `SMC ${signal.entryConfirmation}` : "SMC watchlist",
      reasoning: bias === "WAIT"
        ? "OGFX local engine is waiting for liquidity sweep, displacement, and confirmation to align."
        : `OGFX local engine detected ${bias} structure with protected risk levels.`,
      strategy_alignment: "Local OGFX SMC rules used because the AI provider was unavailable.",
      checklist: [
        { label: "HTF bias reviewed", status: smc?.htfBias?.bias ? "pass" : "pending" },
        { label: "Liquidity sweep checked", status: smc?.sweep?.swept ? "pass" : "pending" },
        { label: "Displacement checked", status: smc?.displacement?.displaced ? "pass" : "pending" },
        { label: "TP/SL defined", status: signal.stopLoss && signal.takeProfit ? "pass" : "pending" },
      ],
      gemma_analysis: warning,
    }, "local", "ogfx-smc-fallback"),
    warning,
    pair,
    timeframe,
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const pair = String(body?.pair || body?.assetId || "XAUUSD").toUpperCase();
  const timeframe = normalizeTimeframe(body?.timeframe || body?.interval);
  const asset = getTradingAsset(pair);

  if (!asset || !VALID_PAIRS.has(pair)) {
    return NextResponse.json({ error: "Unknown trading pair" }, { status: 400 });
  }

  const { data: strategy } = body?.strategyId
    ? await supabase
        .from("user_strategies")
        .select("id,name,raw_text")
        .eq("user_id", user.id)
        .eq("id", String(body.strategyId))
        .maybeSingle()
    : await supabase
        .from("user_strategies")
        .select("id,name,raw_text")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const candles = Array.isArray(body?.snapshot?.candles) && body.snapshot.candles.length > 20
    ? body.snapshot.candles
    : await fetchYahooCandles({ pair, timeframe, range: timeframe === "1D" ? "1y" : "60d" });

  if (!Array.isArray(candles) || candles.length < 40) {
    return NextResponse.json({ error: "Not enough market data for analysis" }, { status: 422 });
  }

  const smc = runSmcEngine(candles.slice(-140), pair, timeframe);
  const snapshot = body?.snapshot?.latest ? body.snapshot : snapshotFromCandles(pair, timeframe, candles);
  const prompt = smcAnalysisPrompt(String(strategy?.raw_text || "").slice(0, 12000));
  const userMessage = [
    `Pair: ${pair}`,
    `TradingView symbol: ${asset.tradingViewSymbol}`,
    `Timeframe: ${timeframe}`,
    `Current market snapshot: ${JSON.stringify(snapshot).slice(0, 9000)}`,
    `OGFX deterministic SMC engine result: ${JSON.stringify(smc).slice(0, 7000)}`,
    `Recent OHLCV candles: ${JSON.stringify(candles.slice(-90)).slice(0, 9000)}`,
    strategy?.name ? `Active user strategy name: ${strategy.name}` : "No active uploaded strategy.",
  ].join("\n\n");

  let analysis: ReturnType<typeof localFallback> | Awaited<ReturnType<typeof callGemmaAnalysis>>;
  try {
    analysis = await callGemmaAnalysis({
      systemPrompt: prompt,
      userMessage,
      imageDataUrl: typeof body?.imageDataUrl === "string" ? body.imageDataUrl : undefined,
    });
  } catch (error) {
    analysis = localFallback(pair, timeframe, smc, snapshot, friendlyAiError(error));
  }

  const shouldSave = analysis.bias === "BUY" || analysis.bias === "SELL";
  let savedSignal = null;
  if (shouldSave) {
    const { data } = await supabase
      .from("signals")
      .insert({
        user_id: user.id,
        symbol: pair,
        pair,
        direction: analysis.bias,
        signal: analysis.bias,
        bias: analysis.bias,
        timeframe,
        entry: analysis.entry,
        entry_price: analysis.entry,
        stop_loss: analysis.stop_loss,
        take_profit: analysis.take_profit,
        rr_ratio: analysis.rr_ratio,
        risk_reward: analysis.rr_ratio,
        confidence: analysis.confidence,
        strategy: analysis.setup_type,
        strategy_name: strategy?.name || null,
        setup_type: analysis.setup_type,
        reasoning: analysis.reasoning,
        reason: analysis.reasoning,
        checklist: analysis.checklist,
        gemma_analysis: analysis.gemma_analysis,
        strategy_alignment: analysis.strategy_alignment,
        chart_snapshot_url: null,
        confirmation_type: analysis.provider === "local" ? "OGFX_LOCAL_SMC" : `AI_${analysis.provider.toUpperCase()}`,
        status: "active",
      })
      .select("*")
      .maybeSingle();
    savedSignal = data;
  }

  return NextResponse.json({
    success: true,
    signal: savedSignal,
    analysis,
    smc,
    snapshot,
  });
}
