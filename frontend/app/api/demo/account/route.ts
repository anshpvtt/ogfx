import { NextResponse, type NextRequest } from "next/server";
import {
  ensureDemoAccount,
  ensureDemoSettings,
  recalculateDemoAccount,
  syncUserOpenOrders,
} from "@/lib/demo-trading";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function getUserOrResponse() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }

  return { supabase, user };
}

export async function GET() {
  const auth = await getUserOrResponse();
  if (auth.response) return auth.response;
  const { supabase, user } = auth;

  try {
    await ensureDemoAccount(supabase, user.id);
    const synced = await syncUserOpenOrders(supabase, user.id);
    const settings = await ensureDemoSettings(supabase, user.id);
    const { data: orders, error } = await supabase
      .from("demo_orders")
      .select("*")
      .eq("user_id", user.id)
      .order("opened_at", { ascending: false })
      .limit(60);

    if (error) throw new Error(error.message);

    return NextResponse.json({
      account: synced.account,
      settings,
      orders: orders ?? [],
      closedBySync: synced.closed,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to load demo account" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await getUserOrResponse();
  if (auth.response) return auth.response;
  const { supabase, user } = auth;
  const body = await request.json().catch(() => null);
  const initialBalance = Number(body?.initialBalance);

  if (!Number.isFinite(initialBalance) || initialBalance < 100 || initialBalance > 100000000) {
    return NextResponse.json({ error: "Initial balance must be between 100 and 100,000,000" }, { status: 400 });
  }

  try {
    await ensureDemoAccount(supabase, user.id);
    const now = new Date().toISOString();

    await supabase
      .from("demo_orders")
      .update({
        status: "CLOSED",
        closed_at: now,
        exit_price: null,
        pnl: 0,
        updated_at: now,
      })
      .eq("user_id", user.id)
      .in("status", ["OPEN", "open", "pending", "PENDING"]);

    const { data, error } = await supabase
      .from("demo_accounts")
      .update({
        initial_balance: initialBalance,
        balance: initialBalance,
        equity: initialBalance,
        free_margin: initialBalance,
        margin: 0,
        margin_level: null,
        realized_pnl: 0,
        updated_at: now,
      })
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    const account = await recalculateDemoAccount(supabase, user.id);
    const settings = await ensureDemoSettings(supabase, user.id);
    await supabase
      .from("demo_account_settings")
      .upsert({
        user_id: user.id,
        balance: account?.balance ?? initialBalance,
        equity: account?.equity ?? initialBalance,
        margin: account?.margin ?? 0,
        free_margin: account?.free_margin ?? initialBalance,
        margin_level: account?.margin_level ?? null,
        leverage: settings?.leverage ?? 100,
        updated_at: now,
      }, { onConflict: "user_id" });

    return NextResponse.json({ account: account ?? data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update capital" }, { status: 500 });
  }
}
