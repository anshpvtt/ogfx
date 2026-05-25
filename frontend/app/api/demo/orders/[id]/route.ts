import { NextResponse, type NextRequest } from "next/server";
import { fetchMarketSnapshot, orderMargin, recalculateDemoAccount, type DemoOrderSide } from "@/lib/demo-trading";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function validateLevels(side: DemoOrderSide, entry: number, stopLoss: number, takeProfit: number) {
  if (side === "BUY") return stopLoss < entry && takeProfit > entry;
  return stopLoss > entry && takeProfit < entry;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const params = await context.params;

  try {
    const { data: order, error } = await supabase
      .from("demo_orders")
      .select("*")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .in("status", ["OPEN", "open", "pending", "PENDING"])
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!order) return NextResponse.json({ error: "Open or pending order not found" }, { status: 404 });

    const status = String(order.status).toLowerCase();
    const isPending = status === "pending";
    const assetId = String(order.asset_id ?? order.symbol ?? "");
    const side = (order.side ?? order.direction) as DemoOrderSide;
    const entry = Number(isPending ? body?.entry ?? order.entry ?? order.entry_price : order.entry ?? order.entry_price);
    const stopLoss = Number(body?.stopLoss);
    const takeProfit = Number(body?.takeProfit);
    const size = Number(isPending ? body?.size ?? order.size ?? order.lot_size : order.size ?? order.lot_size);

    if (
      (side !== "BUY" && side !== "SELL") ||
      ![entry, stopLoss, takeProfit, size].every(Number.isFinite) ||
      size <= 0
    ) {
      return NextResponse.json({ error: "Invalid order modification" }, { status: 400 });
    }

    if (!validateLevels(side, entry, stopLoss, takeProfit)) {
      return NextResponse.json({ error: "TP/SL levels do not match the order side" }, { status: 400 });
    }

    if (isPending) {
      const { data: account, error: accountError } = await supabase
        .from("demo_accounts")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (accountError) throw new Error(accountError.message);
      const requiredMargin = orderMargin({ entry, size });
      if (Number(account?.free_margin ?? account?.balance ?? 0) < requiredMargin) {
        return NextResponse.json({ error: "Insufficient demo free margin" }, { status: 422 });
      }
    }

    const now = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      stop_loss: stopLoss,
      take_profit: takeProfit,
      updated_at: now,
    };

    if (isPending) {
      updatePayload.entry = entry;
      updatePayload.entry_price = entry;
      updatePayload.open_price = entry;
      updatePayload.size = size;
      updatePayload.lot_size = size;
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from("demo_orders")
      .update(updatePayload)
      .eq("id", order.id)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (updateError) throw new Error(updateError.message);
    const snapshots = {} as Record<string, Awaited<ReturnType<typeof fetchMarketSnapshot>>>;
    if (!isPending && assetId) {
      try {
        snapshots[assetId] = await fetchMarketSnapshot(assetId, "1H");
      } catch {
        // A level edit should still succeed if the quote provider is briefly unavailable.
      }
    }
    const account = await recalculateDemoAccount(supabase, user.id, snapshots);

    return NextResponse.json({ order: updatedOrder, account });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to modify order" }, { status: 500 });
  }
}
