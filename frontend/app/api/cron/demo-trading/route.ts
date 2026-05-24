import { NextResponse, type NextRequest } from "next/server";
import { getTradingAsset } from "@/lib/assets";
import {
  closeDemoOrder,
  defaultWatchedAssets,
  ensureDemoAccount,
  evaluateDemoDecision,
  fetchMarketSnapshot,
  orderMargin,
  recalculateDemoAccount,
  type DemoMarketSnapshot,
  type DemoOrderRow,
} from "@/lib/demo-trading";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function verifyCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  return Boolean(secret && header === `Bearer ${secret}`);
}

async function upsertSnapshot(cache: Record<string, DemoMarketSnapshot>, assetId: string) {
  if (!cache[assetId]) cache[assetId] = await fetchMarketSnapshot(assetId, "1H");
  return cache[assetId];
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const runStarted = new Date().toISOString();
  const { data: run } = await admin
    .from("strategy_cron_runs")
    .insert({ run_type: "demo_trading", status: "running", started_at: runStarted })
    .select("id")
    .single();

  const snapshots: Record<string, DemoMarketSnapshot> = {};
  const affectedUsers = new Set<string>();
  const closed: Array<{ id: string; status: "TP" | "SL"; pnl: number }> = [];
  const opened: Array<{ id: string; userId: string; assetId: string; side: string }> = [];
  const signals: Array<{ userId: string; assetId: string; signal: string; confidence?: number }> = [];

  try {
    const { data: openOrders, error: ordersError } = await admin
      .from("demo_orders")
      .select("*")
      .eq("status", "OPEN");

    if (ordersError) throw new Error(ordersError.message);

    for (const order of (openOrders ?? []) as DemoOrderRow[]) {
      const snapshot = await upsertSnapshot(snapshots, order.asset_id);
      const latestPrice = snapshot.latest?.close;
      if (!latestPrice) continue;

      const hitTp = order.side === "BUY" ? latestPrice >= order.take_profit : latestPrice <= order.take_profit;
      const hitSl = order.side === "BUY" ? latestPrice <= order.stop_loss : latestPrice >= order.stop_loss;
      if (!hitTp && !hitSl) continue;

      const exitPrice = hitTp ? Number(order.take_profit) : Number(order.stop_loss);
      const result = await closeDemoOrder(admin, order, exitPrice, hitTp ? "TP" : "SL");
      closed.push({ id: order.id, status: hitTp ? "TP" : "SL", pnl: result.pnl });
      affectedUsers.add(order.user_id);
    }

    const { data: settings, error: settingsError } = await admin
      .from("demo_account_settings")
      .select("*")
      .eq("auto_trading_enabled", true);

    if (settingsError) throw new Error(settingsError.message);

    for (const setting of settings ?? []) {
      await ensureDemoAccount(admin, setting.user_id);
      const { data: userOpenOrders } = await admin
        .from("demo_orders")
        .select("*")
        .eq("user_id", setting.user_id)
        .eq("status", "OPEN");

      const openForUser = ((userOpenOrders ?? []) as DemoOrderRow[]).slice();
      let openCount = openForUser.length;
      const maxOpen = Number(setting.max_open_trades ?? 5);
      const defaultSize = Number(setting.default_size ?? 1);

      for (const assetId of defaultWatchedAssets(setting.watched_assets)) {
        if (openCount >= maxOpen) break;
        if (openForUser.some((order) => order.asset_id === assetId)) continue;

        const asset = getTradingAsset(assetId);
        if (!asset) continue;
        const snapshot = await upsertSnapshot(snapshots, asset.id);
        let decision = evaluateDemoDecision(snapshot);

        try {
          const agentResponse = await fetch(new URL("/api/agent/analyze", request.url), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.CRON_SECRET}`,
            },
            body: JSON.stringify({
              assetId: asset.id,
              interval: "1H",
              snapshot,
              strategyLogic: {
                source: "cron",
                rule: "Generate live OGFX signals using all strategy datasets, SMC sweep logic, BOS/MSS confirmation, HTF alignment, TP/SL discipline, and max-risk guardrails.",
              },
              requireGemma: true,
            }),
          });
          const rawAgent = await agentResponse.text();
          const payload = rawAgent ? JSON.parse(rawAgent) : {};
          if (agentResponse.ok && payload.decision) {
            decision = payload.decision;
          }
        } catch {
          continue;
        }

        const signalSide = decision.decision === "BUY" || decision.decision === "SELL" ? decision.decision : "NO_SETUP";
        const confidenceLabel = decision.confidence >= 75 ? "HIGH" : decision.confidence >= 55 ? "MEDIUM" : "LOW";

        await admin.from("signals").insert({
          user_id: setting.user_id,
          pair: asset.id,
          timeframe: "1H",
          signal: signalSide,
          bias: decision.bias,
          entry: decision.entry,
          stop_loss: decision.stopLoss,
          take_profit: decision.takeProfit,
          risk_reward: decision.riskReward,
          confidence: confidenceLabel,
          confirmation_type: "GEMMA_CRON",
        });
        signals.push({ userId: setting.user_id, assetId: asset.id, signal: signalSide, confidence: decision.confidence });

        if (
          decision.decision === "WAIT" ||
          decision.confidence < 68 ||
          !decision.entry ||
          !decision.stopLoss ||
          !decision.takeProfit
        ) {
          continue;
        }

        const { data: account } = await admin
          .from("demo_accounts")
          .select("*")
          .eq("user_id", setting.user_id)
          .maybeSingle();

        const requiredMargin = orderMargin({ entry: decision.entry, size: defaultSize });
        if (Number(account?.free_margin ?? account?.balance ?? 0) < requiredMargin) continue;

        const { data: order, error: insertError } = await admin
          .from("demo_orders")
          .insert({
            user_id: setting.user_id,
            asset_id: asset.id,
            trading_view_symbol: asset.tradingViewSymbol,
            side: decision.decision,
            entry: decision.entry,
            stop_loss: decision.stopLoss,
            take_profit: decision.takeProfit,
            size: defaultSize,
            status: "OPEN",
            source: "agent-cron",
            confidence: decision.confidence,
            reason: decision.summary,
          })
          .select("*")
          .single();

        if (insertError) throw new Error(insertError.message);
        opened.push({ id: order.id, userId: setting.user_id, assetId: asset.id, side: decision.decision });
        affectedUsers.add(setting.user_id);
        openForUser.push(order as DemoOrderRow);
        openCount += 1;
      }
    }

    for (const userId of Array.from(affectedUsers)) {
      await recalculateDemoAccount(admin, userId, snapshots);
    }

    const summary = {
      closed,
      opened,
      signals,
      affectedUsers: affectedUsers.size,
      checkedSnapshots: Object.keys(snapshots),
    };

    if (run?.id) {
      await admin
        .from("strategy_cron_runs")
        .update({
          status: "success",
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
          error: error?.message || "Demo trading cron failed",
        })
        .eq("id", run.id);
    }

    return NextResponse.json({ error: error?.message || "Demo trading cron failed" }, { status: 500 });
  }
}
