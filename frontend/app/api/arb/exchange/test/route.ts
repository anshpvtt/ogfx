import { NextResponse, type NextRequest } from "next/server";
import { EXCHANGES_SIMULATED } from "@/lib/cryptoPriceFeed";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const exchangeName = String(body?.exchangeName || "");
  if (!EXCHANGES_SIMULATED.includes(exchangeName as any)) {
    return NextResponse.json({ error: "Unknown exchange" }, { status: 400 });
  }

  const { data } = await supabase
    .from("arb_exchange_keys")
    .select("api_key_encrypted,secret_encrypted,is_active")
    .eq("user_id", user.id)
    .eq("exchange_name", exchangeName)
    .maybeSingle();

  return NextResponse.json({
    exchangeName,
    status: data?.api_key_encrypted && data?.secret_encrypted ? "connected-paper-ready" : "api-key-missing",
    mode: "paper",
    message: data?.api_key_encrypted && data?.secret_encrypted
      ? `${exchangeName} credentials are stored. Live trading remains disabled; paper mode only.`
      : `${exchangeName} has no stored API key yet. Simulation remains active.`,
  });
}
