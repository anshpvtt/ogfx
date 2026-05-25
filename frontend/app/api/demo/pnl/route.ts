import { NextResponse, type NextRequest } from "next/server";
import { syncUserOpenOrders } from "@/lib/demo-trading";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
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

  const { data: openOrders, error } = await supabase
    .from("demo_orders")
    .select("user_id")
    .in("status", ["OPEN", "open", "pending", "PENDING"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = Array.from(new Set((openOrders ?? []).map((order: any) => String(order.user_id)).filter(Boolean)));
  const results = [];

  for (const userId of userIds) {
    try {
      const result = await syncUserOpenOrders(supabase, userId, "1H");
      if (result.account) {
        await supabase
          .from("demo_account_settings")
          .upsert({
            user_id: userId,
            balance: result.account.balance ?? 10000,
            equity: result.account.equity ?? result.account.balance ?? 10000,
            margin: result.account.margin ?? 0,
            free_margin: result.account.free_margin ?? result.account.balance ?? 10000,
            margin_level: result.account.margin_level ?? null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
      }
      results.push({ userId, closed: result.closed });
    } catch (error: any) {
      results.push({ userId, error: error?.message || "P&L sync failed" });
    }
  }

  return NextResponse.json({ success: true, users: userIds.length, results });
}
