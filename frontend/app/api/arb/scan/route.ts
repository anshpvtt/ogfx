import { NextResponse } from "next/server";
import { scanForArbitrage } from "@/lib/arbEngine";
import { fetchCryptoPriceFeed } from "@/lib/cryptoPriceFeed";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const feed = await fetchCryptoPriceFeed();
  return NextResponse.json({
    ...feed,
    opportunities: scanForArbitrage(feed.exchangePrices),
  });
}
