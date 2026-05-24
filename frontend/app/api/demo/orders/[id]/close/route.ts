import { NextResponse, type NextRequest } from "next/server";
import { closeDemoOrder, fetchMarketSnapshot, recalculateDemoAccount, type DemoOrderRow } from "@/lib/demo-trading";
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
      .eq("status", "OPEN")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!order) return NextResponse.json({ error: "Open order not found" }, { status: 404 });

    const snapshot = await fetchMarketSnapshot(order.asset_id, "1H");
    const exitPrice = Number(body?.exitPrice ?? snapshot.latest?.close ?? order.entry);
    if (!Number.isFinite(exitPrice)) {
      return NextResponse.json({ error: "No valid exit price available" }, { status: 422 });
    }

    const result = await closeDemoOrder(supabase, order as DemoOrderRow, exitPrice, "CLOSED");
    const account = await recalculateDemoAccount(supabase, user.id, { [order.asset_id]: snapshot });

    return NextResponse.json({ closed: { id: order.id, ...result, exitPrice }, account });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to close order" }, { status: 500 });
  }
}
