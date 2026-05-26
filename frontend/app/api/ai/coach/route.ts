import { NextResponse, type NextRequest } from "next/server";
import { callGemmaCoach, friendlyAiError, type GeminiImageInput } from "@/lib/ai/gemma";
import { coachPrompt } from "@/lib/ai/prompts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type CoachImage = {
  name: string;
  mimeType: string;
  bytes: number;
  data: string;
};

function clip(value: unknown, max = 6000) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}... [truncated]` : text;
}

async function safeRead<T>(label: string, query: PromiseLike<{ data: T | null; error: any }>) {
  try {
    const { data, error } = await query;
    return { label, data, error: error?.message ? String(error.message) : null };
  } catch (error: any) {
    return { label, data: null, error: String(error?.message || error || "query failed") };
  }
}

function base64Bytes(base64: string) {
  const clean = base64.replace(/\s/g, "").replace(/=+$/, "");
  return Math.ceil((clean.length * 3) / 4);
}

function normalizeImages(body: any) {
  const rawSources = Array.isArray(body?.images)
    ? body.images
    : [body?.imageDataUrl || body?.imageBase64].filter(Boolean);
  const warnings: string[] = [];
  const images: CoachImage[] = [];

  for (const source of rawSources.slice(0, MAX_IMAGES)) {
    const value = typeof source === "object"
      ? String(source.dataUrl || source.data || "")
      : String(source || "");
    if (!value) continue;

    const match = value.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = String(
      (typeof source === "object" && (source.mimeType || source.mime_type || source.type)) ||
      match?.[1] ||
      body?.imageMimeType ||
      "image/png"
    ).toLowerCase();
    const data = match?.[2] || value.replace(/^data:[^;]+;base64,/, "");
    const bytes = base64Bytes(data);
    const name = String((typeof source === "object" && source.name) || `image-${images.length + 1}`);

    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      warnings.push(`${name} skipped because ${mimeType} is not supported.`);
      continue;
    }

    if (bytes > MAX_IMAGE_BYTES) {
      warnings.push(`${name} skipped because it is larger than 5 MB.`);
      continue;
    }

    images.push({ name, mimeType, bytes, data });
  }

  if (rawSources.length > MAX_IMAGES) {
    warnings.push(`Only the first ${MAX_IMAGES} images were used.`);
  }

  return { images, warnings };
}

function summarizeOrders(orders: any[] = []) {
  const closed = orders.filter((order) => String(order?.status || "").toUpperCase() !== "OPEN");
  const wins = closed.filter((order) => Number(order?.pnl) > 0).length;
  const pnl = closed.reduce((sum, order) => sum + Number(order?.pnl || 0), 0);
  return {
    totalOrders: orders.length,
    closedTrades: closed.length,
    openTrades: orders.length - closed.length,
    wins,
    winRate: closed.length ? Number(((wins / closed.length) * 100).toFixed(2)) : 0,
    netPnl: Number(pnl.toFixed(2)),
    averagePnl: closed.length ? Number((pnl / closed.length).toFixed(2)) : 0,
  };
}

function contextPacket(input: {
  user: any;
  question: string;
  strategy: any;
  allStrategies: any;
  profile: any;
  demoAccount: any;
  demoSettings: any;
  orders: any[];
  signals: any[];
  backtests: any[];
  previousMessages: any[];
  clientContext: any;
  images: CoachImage[];
  warnings: string[];
  queryWarnings: string[];
}) {
  const activeStrategyText = String(input.strategy?.raw_text || "").slice(0, 16000);
  const packet = {
    request: {
      question: input.question,
      timestamp: new Date().toISOString(),
      attachedImages: input.images.map((image) => ({
        name: image.name,
        mimeType: image.mimeType,
        bytes: image.bytes,
      })),
      warnings: input.warnings,
    },
    user: {
      id: input.user.id,
      email: input.user.email ?? null,
    },
    profile: input.profile,
    strategy: {
      selected: input.strategy
        ? {
            id: input.strategy.id,
            name: input.strategy.name,
            description: input.strategy.description,
            is_active: input.strategy.is_active,
            created_at: input.strategy.created_at,
          }
        : null,
      allStrategies: input.allStrategies,
      rawText: activeStrategyText || null,
    },
    demo: {
      account: input.demoAccount,
      settings: input.demoSettings,
      orderStats: summarizeOrders(input.orders),
      recentOrders: input.orders,
    },
    marketWork: {
      recentSignals: input.signals,
      recentBacktests: input.backtests,
    },
    conversation: {
      previousMessages: input.previousMessages,
    },
    clientContext: input.clientContext ?? null,
    dataWarnings: input.queryWarnings,
  };

  return [
    "This is the complete OGFX AI coach context packet for a single model call.",
    "Use the attached images, if any, as part of this same request.",
    "",
    clip(packet, 42000),
  ].join("\n");
}

function fallbackCoachResponse(question: string, warning: string, hasImages: boolean) {
  return [
    `AI coach fallback is active: ${warning}`,
    "",
    hasImages
      ? "I could not inspect the attached image with the vision model in this response, so treat chart-image comments as unavailable until the AI key/model is fixed."
      : "No image analysis was needed for this fallback response.",
    "",
    `Your question: ${question}`,
    "",
    "Fallback checklist:",
    "- Define entry, stop, take profit, invalidation, and risk before any demo trade.",
    "- Take only LSBR/Shakuni setups where liquidity sweep, structure shift, displacement, and POI retest agree.",
    "- Reduce size or skip when the trade sits in the middle of a range or conflicts with your uploaded strategy.",
    "- Review recent losing trades for repeated rule breaks before adding new risk.",
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const { images, warnings: imageWarnings } = normalizeImages(body);
  const message = String(body?.message || "").trim() ||
    (images.length ? "Analyze the attached image(s) with my full OGFX trading context." : "");

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const conversationId = body?.conversationId ? String(body.conversationId) : null;
  const [
    profileResult,
    strategiesResult,
    selectedStrategyResult,
    activeStrategyResult,
    conversationResult,
    accountResult,
    settingsResult,
    ordersResult,
    signalsResult,
    backtestsResult,
  ] = await Promise.all([
    safeRead("profiles", supabase.from("profiles").select("*").eq("id", user.id).maybeSingle()),
    safeRead("user_strategies", supabase.from("user_strategies").select("id,name,description,is_active,created_at,updated_at").eq("user_id", user.id).order("created_at", { ascending: false })),
    body?.strategyId
      ? safeRead("selected_strategy", supabase.from("user_strategies").select("*").eq("user_id", user.id).eq("id", String(body.strategyId)).maybeSingle())
      : Promise.resolve({ label: "selected_strategy", data: null, error: null }),
    safeRead("active_strategy", supabase.from("user_strategies").select("*").eq("user_id", user.id).eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle()),
    conversationId
      ? safeRead("ai_conversations", supabase.from("ai_conversations").select("id,messages").eq("user_id", user.id).eq("id", conversationId).maybeSingle())
      : Promise.resolve({ label: "ai_conversations", data: null, error: null }),
    safeRead("demo_accounts", supabase.from("demo_accounts").select("*").eq("user_id", user.id).maybeSingle()),
    safeRead("demo_account_settings", supabase.from("demo_account_settings").select("*").eq("user_id", user.id).maybeSingle()),
    safeRead("demo_orders", supabase.from("demo_orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(40)),
    safeRead("signals", supabase.from("signals").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30)),
    safeRead("backtests", supabase.from("backtests").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10)),
  ]);

  const strategy: any = selectedStrategyResult.data || activeStrategyResult.data;
  const previousMessages = Array.isArray((conversationResult.data as any)?.messages)
    ? (conversationResult.data as any).messages.slice(-12)
    : [];
  const queryWarnings = [
    profileResult,
    strategiesResult,
    selectedStrategyResult,
    activeStrategyResult,
    conversationResult,
    accountResult,
    settingsResult,
    ordersResult,
    signalsResult,
    backtestsResult,
  ].flatMap((result) => result.error ? [`${result.label}: ${result.error}`] : []);
  const fullContext = contextPacket({
    user,
    question: message,
    strategy,
    allStrategies: strategiesResult.data ?? [],
    profile: profileResult.data,
    demoAccount: accountResult.data,
    demoSettings: settingsResult.data,
    orders: Array.isArray(ordersResult.data) ? ordersResult.data : [],
    signals: Array.isArray(signalsResult.data) ? signalsResult.data : [],
    backtests: Array.isArray(backtestsResult.data) ? backtestsResult.data : [],
    previousMessages,
    clientContext: body?.context ?? null,
    images,
    warnings: imageWarnings,
    queryWarnings,
  });
  const prompt = coachPrompt(String(strategy?.raw_text || "").slice(0, 16000), fullContext);
  let content = "";
  let provider = "local";
  let model = "ogfx-coach-fallback";
  let warning: string | null = imageWarnings.length ? imageWarnings.join(" ") : null;

  try {
    const response = await callGemmaCoach({
      systemPrompt: prompt,
      userMessage: message,
      images,
    });
    content = response.content.trim() || "I reviewed your context, but the AI provider returned an empty response. Try again with a more specific question.";
    provider = response.provider;
    model = response.model;
  } catch (error) {
    warning = friendlyAiError(error);
    content = fallbackCoachResponse(message, warning, images.length > 0);
  }

  const now = new Date().toISOString();
  const userMessage = {
    role: "user",
    content: message,
    timestamp: now,
    attachments: images.map((image) => ({ name: image.name, mimeType: image.mimeType, bytes: image.bytes })),
  };
  const assistantMessage = { role: "assistant", content, timestamp: now, provider, model, warning };
  let savedConversation = null;
  let saveError: string | null = null;

  try {
    if ((conversationResult.data as any)?.id) {
      const messages = Array.isArray((conversationResult.data as any)?.messages)
        ? (conversationResult.data as any).messages
        : [];
      const { data, error } = await supabase
        .from("ai_conversations")
        .update({
          messages: [...messages, userMessage, assistantMessage],
          strategy_context_used: strategy?.name || null,
          updated_at: now,
        })
        .eq("id", (conversationResult.data as any).id)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      savedConversation = data;
    } else {
      const { data, error } = await supabase
        .from("ai_conversations")
        .insert({
          user_id: user.id,
          messages: [userMessage, assistantMessage],
          strategy_context_used: strategy?.name || null,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      savedConversation = data;
    }
  } catch (error: any) {
    saveError = String(error?.message || error || "Conversation could not be saved");
  }

  return NextResponse.json({
    conversationId: (savedConversation as any)?.id || conversationId,
    message: assistantMessage,
    contextSummary: {
      imagesUsed: images.length,
      strategy: strategy?.name || "Standard OGFX SMC",
      recentOrders: Array.isArray(ordersResult.data) ? ordersResult.data.length : 0,
      recentSignals: Array.isArray(signalsResult.data) ? signalsResult.data.length : 0,
      recentBacktests: Array.isArray(backtestsResult.data) ? backtestsResult.data.length : 0,
      queryWarnings,
      imageWarnings,
      saveError,
    },
    conversation: savedConversation,
  });
}
