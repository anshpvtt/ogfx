import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data, error } = await supabase
    .from("arb_capital_snapshots")
    .select("*")
    .eq("user_id", user.id)
    .order("snapshot_at", { ascending: true })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshots: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const capital = Number(body?.capital);
  if (!Number.isFinite(capital)) return NextResponse.json({ error: "Capital is required" }, { status: 400 });

  const { error } = await supabase.from("arb_capital_snapshots").insert({
    user_id: user.id,
    capital,
    snapshot_at: body?.snapshotAt ? new Date(Number(body.snapshotAt)).toISOString() : new Date().toISOString(),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
