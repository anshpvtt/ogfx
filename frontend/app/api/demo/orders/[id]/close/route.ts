import { NextResponse, type NextRequest } from "next/server";
import {
  closeDemoOrder,
  fetchMarketSnapshot,
  orderPnl,
  recalculateDemoAccount,
  type DemoOrderRow,
} from "@/lib/demo-trading";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
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

    const normalizedOrder = {
      ...order,
      asset_id: order.asset_id ?? order.symbol,
      side: order.side ?? order.direction,
      entry: Number(order.entry ?? order.entry_price),
      size: Number(order.size ?? order.lot_size),
    } as DemoOrderRow;

    if (String(order.status).toLowerCase() === "pending") {
      const closedAt = new Date().toISOString();
      await supabase
        .from("demo_orders")
        .update({ status: "CLOSED", pnl: 0, closed_at: closedAt, updated_at: closedAt })
        .eq("id", order.id)
        .eq("user_id", user.id);
      const account = await recalculateDemoAccount(supabase, user.id);
      return NextResponse.json({ closed: { id: order.id, pnl: 0, closedAt, exitPrice: null }, account });
    }

    const providedExitPrice = Number(body?.exitPrice);
    const snapshot = Number.isFinite(providedExitPrice) ? null : await fetchMarketSnapshot(normalizedOrder.asset_id, "1H");
    const exitPrice = Number(Number.isFinite(providedExitPrice) ? providedExitPrice : snapshot?.latest?.close ?? normalizedOrder.entry);
    if (!Number.isFinite(exitPrice)) {
      return NextResponse.json({ error: "No valid exit price available" }, { status: 422 });
    }

    const orderSize = Number(normalizedOrder.size ?? 0);
    const requestedCloseSize = Number(body?.closeSize ?? orderSize);
    if (!Number.isFinite(requestedCloseSize) || requestedCloseSize <= 0) {
      return NextResponse.json({ error: "Close size must be greater than zero" }, { status: 400 });
    }

    if (requestedCloseSize < orderSize) {
      const closedAt = new Date().toISOString();
      const closedSize = Number(requestedCloseSize.toFixed(4));
      const remainingSize = Number((orderSize - closedSize).toFixed(4));
      const pnl = orderPnl({
        asset_id: normalizedOrder.asset_id,
        entry: normalizedOrder.entry,
        side: normalizedOrder.side,
        size: closedSize,
      }, exitPrice);

      const { error: updateError } = await supabase
        .from("demo_orders")
        .update({
          size: remainingSize,
          lot_size: remainingSize,
          updated_at: closedAt,
        })
        .eq("id", order.id)
        .eq("user_id", user.id);

      if (updateError) throw new Error(updateError.message);

      const { data: account, error: accountError } = await supabase
        .from("demo_accounts")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (accountError) throw new Error(accountError.message);
      if (account) {
        const balance = Number(account.balance ?? account.initial_balance ?? 10000) + pnl;
        await supabase
          .from("demo_accounts")
          .update({
            balance,
            realized_pnl: Number(account.realized_pnl ?? 0) + pnl,
            updated_at: closedAt,
          })
          .eq("user_id", user.id);
      }

      const snapshots = snapshot ? { [normalizedOrder.asset_id]: snapshot } : {};
      const accountAfterPartial = await recalculateDemoAccount(supabase, user.id, snapshots);
      return NextResponse.json({
        closed: { id: order.id, partial: true, closedSize, remainingSize, pnl, closedAt, exitPrice },
        account: accountAfterPartial,
      });
    }

    const result = await closeDemoOrder(supabase, normalizedOrder, exitPrice, "CLOSED");
    const snapshots = snapshot ? { [normalizedOrder.asset_id]: snapshot } : {};
    const account = await recalculateDemoAccount(supabase, user.id, snapshots);

    return NextResponse.json({ closed: { id: order.id, ...result, exitPrice }, account });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to close order" }, { status: 500 });
  }
}
