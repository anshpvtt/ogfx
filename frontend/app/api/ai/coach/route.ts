import { NextResponse, type NextRequest } from "next/server";
import { callGemmaText, friendlyAiError } from "@/lib/ai/gemma";
import { coachPrompt } from "@/lib/ai/prompts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const message = String(body?.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const { data: strategy } = body?.strategyId
    ? await supabase
        .from("user_strategies")
        .select("id,name,raw_text")
        .eq("user_id", user.id)
        .eq("id", String(body.strategyId))
        .maybeSingle()
    : await supabase
        .from("user_strategies")
        .select("id,name,raw_text")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const { data: trades } = await supabase
    .from("demo_orders")
    .select("asset_id,pair,symbol,side,direction,entry,entry_price,stop_loss,take_profit,pnl,status,created_at,closed_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const prompt = coachPrompt(String(strategy?.raw_text || "").slice(0, 12000), JSON.stringify(trades ?? []).slice(0, 8000));
  let content = "";
  let provider = "local";
  let model = "ogfx-coach-fallback";

  try {
    const response = await callGemmaText(prompt, message);
    content = response.content;
    provider = response.provider;
    model = response.model;
  } catch (error) {
    const warning = friendlyAiError(error);
    content = [
      `AI coach is temporarily unavailable: ${warning}`,
      "",
      "Use the OGFX fallback discipline checklist for now:",
      "- Only take demo trades with defined entry, stop, target, and invalidation.",
      "- Skip trades when liquidity sweep and BOS/MSS do not align.",
      "- Keep risk per demo trade near your configured risk percent.",
    ].join("\n");
  }

  const now = new Date().toISOString();
  const userMessage = { role: "user", content: message, timestamp: now };
  const assistantMessage = { role: "assistant", content, timestamp: now, provider, model };

  if (body?.conversationId) {
    const { data: existing } = await supabase
      .from("ai_conversations")
      .select("id,messages")
      .eq("user_id", user.id)
      .eq("id", String(body.conversationId))
      .maybeSingle();

    if (existing) {
      const messages = Array.isArray(existing.messages) ? existing.messages : [];
      const { data } = await supabase
        .from("ai_conversations")
        .update({
          messages: [...messages, userMessage, assistantMessage],
          strategy_context_used: strategy?.name || null,
          updated_at: now,
        })
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .select("*")
        .single();
      return NextResponse.json({ conversationId: data?.id, message: assistantMessage, conversation: data });
    }
  }

  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({
      user_id: user.id,
      messages: [userMessage, assistantMessage],
      strategy_context_used: strategy?.name || null,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversationId: data.id, message: assistantMessage, conversation: data });
}
