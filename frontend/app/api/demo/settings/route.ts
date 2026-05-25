import { NextResponse, type NextRequest } from "next/server";
import { defaultWatchedAssets, ensureDemoSettings } from "@/lib/demo-trading";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const autoTradingEnabled = Boolean(body?.autoTradingEnabled);
  const riskPerTrade = Number(body?.riskPerTrade ?? 0.01);
  const maxOpenTrades = Number(body?.maxOpenTrades ?? 5);
  const defaultSize = Number(body?.defaultSize ?? 1);
  const watchedAssets = defaultWatchedAssets(body?.watchedAssets);

  if (autoTradingEnabled) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier,subscription_status")
      .eq("id", user.id)
      .maybeSingle();
    const allowed = profile?.subscription_tier === "elite" && ["active", "trialing"].includes(String(profile?.subscription_status));
    if (!allowed) {
      return NextResponse.json({ error: "Auto demo agent requires the Elite plan" }, { status: 403 });
    }
  }

  if (!Number.isFinite(riskPerTrade) || riskPerTrade < 0.001 || riskPerTrade > 0.05) {
    return NextResponse.json({ error: "Risk per trade must be between 0.1% and 5%" }, { status: 400 });
  }
  if (!Number.isInteger(maxOpenTrades) || maxOpenTrades < 1 || maxOpenTrades > 25) {
    return NextResponse.json({ error: "Max open trades must be between 1 and 25" }, { status: 400 });
  }
  if (!Number.isFinite(defaultSize) || defaultSize <= 0 || defaultSize > 100000) {
    return NextResponse.json({ error: "Default size is invalid" }, { status: 400 });
  }

  try {
    await ensureDemoSettings(supabase, user.id);
    const { data, error } = await supabase
      .from("demo_account_settings")
      .update({
        auto_trading_enabled: autoTradingEnabled,
        risk_per_trade: riskPerTrade,
        max_open_trades: maxOpenTrades,
        default_size: defaultSize,
        watched_assets: watchedAssets,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json({ settings: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update demo settings" }, { status: 500 });
  }
}
