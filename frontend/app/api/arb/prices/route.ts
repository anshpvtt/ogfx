import { NextResponse } from "next/server";
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
  return NextResponse.json(feed, {
    headers: {
      "Cache-Control": "private, max-age=8",
    },
  });
}
