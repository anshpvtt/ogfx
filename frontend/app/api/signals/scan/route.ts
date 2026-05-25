import { NextResponse, type NextRequest } from "next/server";
import { TRADING_ASSET_IDS, getTradingAsset } from "@/lib/assets";
import { callGemmaAnalysis, friendlyAiError, normalizeSmcAnalysis } from "@/lib/ai/gemma";
import { smcAnalysisPrompt } from "@/lib/ai/prompts";
import { orderMargin } from "@/lib/demo-trading";
import { snapshotFromCandles } from "@/lib/demo-trading";
import { fetchYahooCandles } from "@/lib/market-data";
import { runSmcEngine } from "@/lib/smc-engine";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

function localAnalysis(pair: string, timeframe: string, smc: any, snapshot: any, warning: string) {
  const signal = smc?.signal ?? {};
  const bias = signal.signal === "BUY" || signal.signal === "SELL" ? signal.signal : "WAIT";
  return normalizeSmcAnalysis({
    bias,
    confidence: signal.confidence === "HIGH" ? 76 : signal.confidence === "MEDIUM" ? 62 : 44,
    entry: signal.entry || snapshot?.latest?.close,
    stop_loss: signal.stopLoss,
    take_profit: signal.takeProfit,
    rr_ratio: signal.riskReward,
    setup_type: signal.entryConfirmation && signal.entryConfirmation !== "NONE" ? `SMC ${signal.entryConfirmation}` : "SMC scan",
    reasoning: warning,
    strategy_alignment: "Local SMC scan used because AI confirmation was unavailable.",
    gemma_analysis: warning,
    checklist: [
      { label: "Bias reviewed", status: smc?.htfBias?.bias ? "pass" : "pending" },
      { label: "Liquidity sweep checked", status: smc?.sweep?.swept ? "pass" : "pending" },
      { label: "TP/SL defined", status: signal.stopLoss && signal.takeProfit ? "pass" : "pending" },
    ],
  }, "local", "ogfx-cron-fallback");
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Supabase service key is required" }, { status: 503 });
  }

  const startedAt = new Date().toISOString();
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,subscription_tier,subscription_status,preferred_pairs")
    .limit(30);

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

  const symbols = TRADING_ASSET_IDS;
  const results: any[] = [];

  for (const profile of profiles ?? []) {
    const tier = String(profile.subscription_tier || "free");
    const allowedPairs = tier === "free"
      ? ["XAUUSD"]
      : Array.isArray(profile.preferred_pairs) && profile.preferred_pairs.length
        ? profile.preferred_pairs.filter((pair: string) => symbols.includes(pair as any))
        : symbols.slice(0, tier === "elite" ? symbols.length : 5);

    const { data: strategy } = await supabase
      .from("user_strategies")
      .select("name,raw_text")
      .eq("user_id", profile.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    for (const pair of allowedPairs.slice(0, 7)) {
      const asset = getTradingAsset(pair);
      if (!asset) continue;
      try {
        const timeframe = "1H";
        const candles = await fetchYahooCandles({ pair, timeframe, range: "60d" });
        if (candles.length < 60) {
          results.push({ userId: profile.id, pair, skipped: "not_enough_data" });
          continue;
        }

        const smc = runSmcEngine(candles.slice(-140), pair, timeframe);
        const snapshot = snapshotFromCandles(pair, timeframe, candles);
        const { data: settings } = await supabase
          .from("demo_account_settings")
          .select("auto_trading_enabled,balance,equity,free_margin,default_size,risk_per_trade,max_open_trades,watched_assets,leverage")
          .eq("user_id", profile.id)
          .maybeSingle();
        const message = [
          `Cron scan pair: ${pair}`,
          `TradingView symbol: ${asset.tradingViewSymbol}`,
          `Timeframe: ${timeframe}`,
          `User capital and risk settings: ${JSON.stringify(settings ?? null).slice(0, 2500)}`,
          `Snapshot: ${JSON.stringify(snapshot).slice(0, 9000)}`,
          `SMC engine: ${JSON.stringify(smc).slice(0, 7000)}`,
          `Candles: ${JSON.stringify(candles.slice(-80)).slice(0, 8000)}`,
        ].join("\n\n");

        let analysis;
        try {
          analysis = await callGemmaAnalysis({
            systemPrompt: smcAnalysisPrompt(String(strategy?.raw_text || "").slice(0, 10000)),
            userMessage: message,
          });
        } catch (error) {
          analysis = localAnalysis(pair, timeframe, smc, snapshot, friendlyAiError(error));
        }

        if (analysis.bias !== "BUY" && analysis.bias !== "SELL") {
          results.push({ userId: profile.id, pair, bias: analysis.bias, confidence: analysis.confidence });
          continue;
        }

        const { data: signal } = await supabase
          .from("signals")
          .insert({
            user_id: profile.id,
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
            confirmation_type: analysis.provider === "local" ? "OGFX_LOCAL_SMC" : `AI_${analysis.provider.toUpperCase()}`,
            status: "active",
          })
          .select("*")
          .maybeSingle();

        let autoOrder = null;
        if (
          signal &&
          tier === "elite" &&
          settings?.auto_trading_enabled &&
          analysis.confidence >= 75 &&
          analysis.entry &&
          analysis.stop_loss &&
          analysis.take_profit
        ) {
          const size = Number(settings.default_size || 1);
          const margin = orderMargin({ asset_id: pair, entry: analysis.entry, size }, Number(settings.leverage ?? 100));
          if (Number(settings.free_margin ?? settings.balance ?? 0) >= margin) {
            const { data: order } = await supabase
              .from("demo_orders")
              .insert({
                user_id: profile.id,
                symbol: pair,
                pair,
                asset_id: pair,
                trading_view_symbol: asset.tradingViewSymbol,
                direction: analysis.bias,
                side: analysis.bias,
                entry_price: analysis.entry,
                entry: analysis.entry,
                open_price: analysis.entry,
                stop_loss: analysis.stop_loss,
                take_profit: analysis.take_profit,
                lot_size: size,
                size,
                status: "OPEN",
                source: "agent-cron",
                confidence: analysis.confidence,
                reason: analysis.reasoning,
                signal_id: signal.id,
              })
              .select("id")
              .maybeSingle();
            autoOrder = order?.id || null;
          }
        }

        results.push({ userId: profile.id, pair, signalId: signal?.id, autoOrder, confidence: analysis.confidence });
      } catch (error: any) {
        results.push({ userId: profile.id, pair, error: error?.message || "scan failed" });
      }
    }
  }

  await supabase.from("strategy_cron_runs").insert({
    ran_at: startedAt,
    status: "completed",
    pairs_scanned: results.length,
    signals_generated: results.filter((item) => item.signalId).length,
    details: results,
  }).then(() => null);

  return NextResponse.json({ success: true, startedAt, results });
}
