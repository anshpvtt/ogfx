import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const trade = body?.trade;
  if (!trade?.id) return NextResponse.json({ error: "Trade payload required" }, { status: 400 });

  const { data, error } = await supabase
    .from("arb_trades")
    .upsert({
      user_id: user.id,
      client_trade_id: trade.id,
      coin: trade.coin,
      coin_id: trade.coinId,
      buy_exchange: trade.buyExchange,
      sell_exchange: trade.sellExchange,
      buy_price: trade.buyPrice,
      sell_price: trade.sellPrice,
      size: trade.size,
      capital_used: trade.capitalUsed,
      gross_spread_pct: trade.grossSpreadPct,
      fees: trade.fees,
      status: "open",
      reason: trade.reason,
      entry_time: new Date(trade.entryTime).toISOString(),
    }, { onConflict: "user_id,client_trade_id" })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trade: data });
}
