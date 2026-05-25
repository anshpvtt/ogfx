import { NextResponse, type NextRequest } from "next/server";
import { getTradingAsset } from "@/lib/assets";
import { ensureDemoAccount, orderMargin, recalculateDemoAccount } from "@/lib/demo-trading";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function validateLevels(side: "BUY" | "SELL", entry: number, stopLoss: number, takeProfit: number) {
  if (side === "BUY") return stopLoss < entry && takeProfit > entry;
  return stopLoss > entry && takeProfit < entry;
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
  const assetId = String(body?.assetId ?? "").toUpperCase();
  const side = body?.side === "SELL" ? "SELL" : "BUY";
  const asset = getTradingAsset(assetId);
  const entry = Number(body?.entry);
  const stopLoss = Number(body?.stopLoss);
  const takeProfit = Number(body?.takeProfit);
  const size = Number(body?.size);
  const orderType = body?.orderType === "pending" ? "pending" : "market";
  const currentPrice = Number(body?.currentPrice ?? entry);

  if (!asset || ![entry, stopLoss, takeProfit, size].every(Number.isFinite) || size <= 0) {
    return NextResponse.json({ error: "Invalid order ticket" }, { status: 400 });
  }
  if (!validateLevels(side, entry, stopLoss, takeProfit)) {
    return NextResponse.json({ error: "TP/SL levels do not match the order side" }, { status: 400 });
  }

  try {
    const account = await ensureDemoAccount(supabase, user.id);
    const requiredMargin = orderMargin({ entry, size });
    if (Number(account.free_margin ?? account.balance ?? 0) < requiredMargin) {
      return NextResponse.json({ error: "Insufficient demo free margin" }, { status: 422 });
    }

    const { data, error } = await supabase
      .from("demo_orders")
      .insert({
        user_id: user.id,
        symbol: asset.id,
        pair: asset.id,
        asset_id: asset.id,
        trading_view_symbol: asset.tradingViewSymbol,
        direction: side,
        side,
        entry_price: entry,
        entry,
        open_price: orderType === "pending" && Number.isFinite(currentPrice) ? currentPrice : entry,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        lot_size: size,
        size,
        status: orderType === "pending" ? "pending" : "OPEN",
        source: body?.source === "agent" ? "agent" : "manual",
        strategy_id: body?.strategyId ?? null,
        strategy_name: body?.strategyName ?? null,
        confidence: Number.isFinite(Number(body?.confidence)) ? Number(body.confidence) : null,
        reason: body?.reason ? String(body.reason).slice(0, 800) : null,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    const syncedAccount = orderType === "pending"
      ? account
      : await recalculateDemoAccount(supabase, user.id);

    return NextResponse.json({ order: data, account: syncedAccount });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to place demo order" }, { status: 500 });
  }
}
