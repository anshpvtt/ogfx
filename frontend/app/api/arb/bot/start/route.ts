import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_BOT_CONFIG } from "@/lib/paperBroker";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const config = { ...DEFAULT_BOT_CONFIG, ...(body?.config || {}) };
  const { error } = await supabase
    .from("arb_bot_configs")
    .upsert({ user_id: user.id, config, is_running: true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, config });
}
