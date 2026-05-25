import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { getTradingAsset } from "@/lib/assets";

type AgentDecision = {
  decision: "BUY" | "SELL" | "WAIT";
  confidence: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  bias: string;
  summary: string;
  reasons: string[];
  invalidation: string;
  model: string;
  mode: "gemma" | "openrouter" | "ollama" | "local-demo";
};

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OLLAMA_ENDPOINT = "https://ollama.com/api/chat";
const BACKEND_API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://ogfx-render-agent-free.onrender.com").replace(/\/$/, "");

async function readJson(relativePath: string, fallback: any = {}) {
  const root = path.basename(process.cwd()) === "frontend" ? path.resolve(process.cwd(), "..") : process.cwd();
  try {
    const raw = await readFile(path.join(root, relativePath), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function readText(relativePath: string, fallback = "") {
  const root = path.basename(process.cwd()) === "frontend" ? path.resolve(process.cwd(), "..") : process.cwd();
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch {
    return fallback;
  }
}

async function loadDatasets() {
  const [defaultStrategy, smcStrategy, strategyLibrary, pdfStrategyText] = await Promise.all([
    readJson("strategies/default.json", {}),
    readJson("strategies/smc.json", {}),
    readJson("backend/data/strategies.json", []),
    readText("docs/SMC-STRATEGY.md", ""),
  ]);

  return {
    defaultStrategy,
    smcStrategy,
    strategyLibrary,
    pdfStrategyText,
  };
}

function getGeminiApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    ""
  );
}

function getOpenRouterApiKey() {
  return process.env.OPENROUTER_API_KEY || "";
}

function getOpenRouterModel() {
  return process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
}

function getOllamaApiKey() {
  return process.env.OLLAMA_API_KEY || "";
}

function getOllamaModel(needsVision = false) {
  if (needsVision) return process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MODEL || "qwen3-vl:235b-instruct";
  return process.env.OLLAMA_MODEL || "gemma4:31b";
}

function friendlyAiError(error: any) {
  const message = String(error?.message || error || "AI provider unavailable");
  if (/free-models-per-day/i.test(message)) {
    return "OpenRouter free model daily limit reached for this account. OGFX local SMC fallback is active until quota resets or credits are added.";
  }
  if (/subscription|upgrade/i.test(message)) {
    return "Selected AI model requires a paid subscription. OGFX is using the next free provider or local SMC fallback.";
  }
  if (/unauthorized|401|403/i.test(message)) {
    return "AI provider rejected the API key. Check the server-side key value; OGFX local SMC fallback is active.";
  }
  if (/429|rate.?limit|temporarily/i.test(message)) {
    return "AI provider is temporarily rate-limited. OGFX local SMC fallback is active.";
  }
  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

async function resolveGemmaModel(apiKey: string, needsVision = false) {
  const configured = process.env.GEMINI_MODEL || process.env.GOOGLE_GEMINI_MODEL;
  if (configured && !(needsVision && configured.toLowerCase().includes("gemma"))) {
    return configured.replace(/^models\//, "");
  }

  const response = await fetch(`${GEMINI_ENDPOINT}/models`, {
    headers: { "x-goog-api-key": apiKey },
    next: { revalidate: 3600 },
  });
  if (!response.ok) return needsVision ? "gemini-2.5-flash" : "gemma-4";

  const payload = await response.json();
  const models: Array<{ name?: string; supportedGenerationMethods?: string[]; supportedActions?: string[] }> =
    payload?.models ?? [];
  const candidates = models.filter((model) => {
    const methods = model.supportedGenerationMethods ?? model.supportedActions ?? [];
    return methods.includes("generateContent");
  });
  const priorities = needsVision
    ? ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini"]
    : ["gemma-4", "gemma", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini"];
  const picked = priorities.flatMap((needle) =>
    candidates.filter((model) => (model.name ?? "").toLowerCase().includes(needle))
  )[0];
  const gemma = picked ?? candidates.find((model) => {
    const name = model.name ?? "";
    return name.toLowerCase().includes("gemma");
  });

  return (gemma?.name ?? candidates[0]?.name ?? "gemini-2.5-flash").replace(/^models\//, "");
}

function coerceDecision(value: any, model: string, mode: AgentDecision["mode"]): AgentDecision {
  const decision = value?.decision === "BUY" || value?.decision === "SELL" || value?.decision === "WAIT" ? value.decision : "WAIT";
  const confidence = Math.max(0, Math.min(100, Number(value?.confidence ?? 50)));
  const stopLoss = value?.stopLoss ?? value?.sl;
  const takeProfit = value?.takeProfit ?? value?.tp;
  const summary = value?.summary ?? value?.reason;

  return {
    decision,
    confidence,
    entry: Number.isFinite(Number(value?.entry)) ? Number(value.entry) : null,
    stopLoss: Number.isFinite(Number(stopLoss)) ? Number(stopLoss) : null,
    takeProfit: Number.isFinite(Number(takeProfit)) ? Number(takeProfit) : null,
    riskReward: Number.isFinite(Number(value?.riskReward ?? value?.rr)) ? Number(value?.riskReward ?? value?.rr) : null,
    bias: String(value?.bias || "NEUTRAL"),
    summary: String(summary || "No high-confidence setup. Wait for cleaner confirmation."),
    reasons: Array.isArray(value?.reasons) ? value.reasons.slice(0, 5).map(String) : [String(value?.reason || "Insufficient confluence")],
    invalidation: String(value?.invalidation || "Setup invalidates if price closes beyond the protected liquidity extreme."),
    model,
    mode,
  };
}

function localDecision(body: any, model = "local-rule-agent"): AgentDecision {
  const latest = body?.snapshot?.latest;
  const close = Number(latest?.close ?? body?.price ?? 0);
  const atr = Number(body?.snapshot?.atr ?? 0);
  const trend = String(body?.snapshot?.trend ?? "NEUTRAL");
  const changePct = Number(body?.snapshot?.dayChangePct ?? 0);
  const volatility = close > 0 && atr > 0 ? (atr / close) * 100 : 0;
  const shouldBuy = trend === "BULLISH" && changePct >= -0.2;
  const shouldSell = trend === "BEARISH" && changePct <= 0.2;
  const decision = shouldBuy ? "BUY" : shouldSell ? "SELL" : "WAIT";
  const stopDistance = atr > 0 ? atr * 1.4 : close * 0.004;
  const targetDistance = stopDistance * 2;

  return {
    decision,
    confidence: decision === "WAIT" ? 54 : Math.min(86, Math.round(62 + Math.abs(changePct) * 8 + volatility * 2)),
    entry: close || null,
    stopLoss: close ? Number((decision === "SELL" ? close + stopDistance : close - stopDistance).toFixed(close > 20 ? 2 : 5)) : null,
    takeProfit: close ? Number((decision === "SELL" ? close - targetDistance : close + targetDistance).toFixed(close > 20 ? 2 : 5)) : null,
    riskReward: decision === "WAIT" ? null : 2,
    bias: trend,
    summary:
      decision === "WAIT"
        ? "Local agent is waiting for stronger SMC confirmation before a demo order."
        : `Local agent sees ${trend.toLowerCase()} structure with acceptable demo risk spacing.`,
    reasons: [
      `Trend state: ${trend}`,
      `Latest change: ${changePct.toFixed(2)}%`,
      `ATR volatility: ${volatility.toFixed(2)}%`,
      "SMC rule guardrails require TP/SL before any demo execution",
    ],
    invalidation: "Invalidate if price closes through the stop-loss side before confirmation.",
    model,
    mode: "local-demo",
  };
}

async function callGemma({
  apiKey,
  model,
  prompt,
  imageParts = [],
}: {
  apiKey: string;
  model: string;
  prompt: string;
  imageParts?: Array<{ inline_data: { mime_type: string; data: string } }>;
}) {
  const response = await fetch(
    `${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gemma returned ${response.status}: ${raw.slice(0, 220)}`);
  }

  const payload = JSON.parse(raw || "{}");
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join("") ?? "{}";
  return parseGemmaJson(text);
}

function parseGemmaJson(text: string) {
  const cleaned = String(text || "{}")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed[0] ?? {} : parsed;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed[0] ?? {} : parsed;
    }
    throw new Error("Gemma returned non-JSON analysis");
  }
}

function toImageParts(body: any) {
  const sources = Array.isArray(body?.images) ? body.images : [body?.imageDataUrl || body?.imageBase64].filter(Boolean);
  return sources.flatMap((source: any) => {
    if (!source) return [];
    if (typeof source === "object" && source.data) {
      return [{
        inline_data: {
          mime_type: String(source.mimeType || source.mime_type || "image/png"),
          data: String(source.data).replace(/^data:[^;]+;base64,/, ""),
        },
      }];
    }
    const value = String(source);
    const match = value.match(/^data:([^;]+);base64,(.+)$/);
    return [{
      inline_data: {
        mime_type: match?.[1] || body?.imageMimeType || "image/png",
        data: match?.[2] || value,
      },
    }];
  });
}

function toOpenRouterImageParts(body: any) {
  const sources = Array.isArray(body?.images) ? body.images : [body?.imageDataUrl || body?.imageBase64].filter(Boolean);
  return sources.flatMap((source: any) => {
    if (!source) return [];
    if (typeof source === "object" && source.data) {
      const mimeType = String(source.mimeType || source.mime_type || "image/png");
      const raw = String(source.data);
      return [{
        type: "image_url",
        image_url: {
          url: raw.startsWith("data:") ? raw : `data:${mimeType};base64,${raw.replace(/^data:[^;]+;base64,/, "")}`,
        },
      }];
    }

    const value = String(source);
    return [{
      type: "image_url",
      image_url: {
        url: value.startsWith("data:") ? value : `data:${body?.imageMimeType || "image/png"};base64,${value}`,
      },
    }];
  });
}

function toOllamaImages(body: any) {
  const sources = Array.isArray(body?.images) ? body.images : [body?.imageDataUrl || body?.imageBase64].filter(Boolean);
  return sources.flatMap((source: any) => {
    if (!source) return [];
    if (typeof source === "object" && source.data) {
      return [String(source.data).replace(/^data:[^;]+;base64,/, "")];
    }

    return [String(source).replace(/^data:[^;]+;base64,/, "")];
  });
}

async function callOllama({
  apiKey,
  model,
  prompt,
  images = [],
}: {
  apiKey: string;
  model: string;
  prompt: string;
  images?: string[];
}) {
  const response = await fetch(OLLAMA_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: prompt,
        ...(images.length ? { images } : {}),
      }],
      stream: false,
      format: "json",
      options: {
        temperature: 0.1,
        num_predict: 800,
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${raw.slice(0, 220)}`);
  }

  const payload = JSON.parse(raw || "{}");
  const text = payload?.message?.content ?? payload?.response ?? "{}";
  return parseGemmaJson(text);
}

async function callOpenRouter({
  apiKey,
  model,
  prompt,
  imageParts = [],
}: {
  apiKey: string;
  model: string;
  prompt: string;
  imageParts?: Array<{ type: "image_url"; image_url: { url: string } }>;
}) {
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://ogfx-frontend.vercel.app",
      "X-Title": "OGFX Elite SMC Trading Engine",
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: imageParts.length ? [{ type: "text", text: prompt }, ...imageParts] : prompt,
      }],
      temperature: 0.1,
      max_tokens: 700,
      response_format: { type: "json_object" },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}: ${raw.slice(0, 220)}`);
  }

  const payload = JSON.parse(raw || "{}");
  const content = payload?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part: any) => part?.text || "").join("")
    : String(content || "{}");
  return parseGemmaJson(text);
}

async function callBackendAgent(body: any) {
  const response = await fetch(`${BACKEND_API_URL}/agent/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Backend agent returned ${response.status}: ${raw.slice(0, 220)}`);
  }

  const payload = JSON.parse(raw || "{}");
  if (!payload?.decision) throw new Error("Backend agent returned no decision");
  return payload.decision;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const assetId = String(body?.assetId ?? "").toUpperCase();
  const asset = getTradingAsset(assetId);

  if (!body || !asset) {
    return NextResponse.json({ error: "Invalid analysis request" }, { status: 400 });
  }

  const datasets = await loadDatasets();
  const ollamaApiKey = getOllamaApiKey();
  const openRouterApiKey = getOpenRouterApiKey();
  const geminiApiKey = getGeminiApiKey();
  const imageParts = toImageParts(body);
  const ollamaImages = toOllamaImages(body);
  const openRouterImageParts = toOpenRouterImageParts(body);
  const model = openRouterApiKey
    ? getOpenRouterModel()
    : ollamaApiKey
      ? getOllamaModel(ollamaImages.length > 0)
      : geminiApiKey
        ? await resolveGemmaModel(geminiApiKey, imageParts.length > 0)
        : getOpenRouterModel();
  const requireGemma = Boolean(body.requireGemma);

  const prompt = [
    "You are OGFX Agent, a demo-only Smart Money Concepts analyst. Do not claim certainty and do not provide financial advice.",
    "Return strict JSON only with keys: decision, confidence, entry, stopLoss, takeProfit, riskReward, bias, summary, reasons, invalidation.",
    "Allowed decision values: BUY, SELL, WAIT. Confidence must be 0-100. TP/SL must be present for BUY/SELL.",
    imageParts.length ? "Attached image(s) are chart screenshots. Read market structure, candles, liquidity, zones, trend, and visible price action from them, but only trade if the OGFX strategy rules agree." : "",
    `Asset: ${asset.id} (${asset.name})`,
    `Timeframe: ${body.interval ?? "15"}`,
    `Market snapshot: ${JSON.stringify(body.snapshot ?? null).slice(0, 6000)}`,
    `Required OGFX strategy logic: ${JSON.stringify(body.strategyLogic ?? null).slice(0, 6000)}`,
    `Open demo orders: ${JSON.stringify(body.openOrders ?? []).slice(0, 2000)}`,
    `Recent demo history: ${JSON.stringify(body.history ?? []).slice(0, 2000)}`,
    `Datasets: ${JSON.stringify(datasets).slice(0, 9000)}`,
  ].join("\n\n");

  if (!ollamaApiKey && !openRouterApiKey && !geminiApiKey) {
    try {
      const backendDecision = await callBackendAgent(body);
      return NextResponse.json({ decision: backendDecision });
    } catch (error) {
      if (!requireGemma) {
        return NextResponse.json({
          decision: localDecision(body, model),
          warning: friendlyAiError(error),
        });
      }
    }

    if (requireGemma) {
      return NextResponse.json(
        { error: "OLLAMA_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY is required for production signal generation" },
        { status: 503 }
      );
    }

    return NextResponse.json({
      decision: localDecision(body, model),
      warning: "No server-side Gemini API key configured. Using deterministic local demo agent.",
    });
  }

  const errors: string[] = [];
  try {
    if (openRouterApiKey) {
      const rawDecision = await callOpenRouter({ apiKey: openRouterApiKey, model, prompt, imageParts: openRouterImageParts });
      return NextResponse.json({ decision: coerceDecision(rawDecision, model, "openrouter") });
    }

    if (ollamaApiKey) {
      const ollamaModel = getOllamaModel(ollamaImages.length > 0);
      const rawDecision = await callOllama({ apiKey: ollamaApiKey, model: ollamaModel, prompt, images: ollamaImages });
      return NextResponse.json({ decision: coerceDecision(rawDecision, ollamaModel, "ollama") });
    }

    const rawDecision = await callGemma({ apiKey: geminiApiKey, model, prompt, imageParts });
    return NextResponse.json({ decision: coerceDecision(rawDecision, model, "gemma") });
  } catch (error: any) {
    errors.push(friendlyAiError(error));
  }

  try {
    if (ollamaApiKey && openRouterApiKey) {
      const ollamaModel = getOllamaModel(ollamaImages.length > 0);
      const rawDecision = await callOllama({ apiKey: ollamaApiKey, model: ollamaModel, prompt, images: ollamaImages });
      return NextResponse.json({ decision: coerceDecision(rawDecision, ollamaModel, "ollama") });
    }

    if (geminiApiKey && (ollamaApiKey || openRouterApiKey)) {
      const geminiModel = await resolveGemmaModel(geminiApiKey, imageParts.length > 0);
      const rawDecision = await callGemma({ apiKey: geminiApiKey, model: geminiModel, prompt, imageParts });
      return NextResponse.json({ decision: coerceDecision(rawDecision, geminiModel, "gemma") });
    }
  } catch (error: any) {
    errors.push(friendlyAiError(error));
  }

  try {
    const backendDecision = await callBackendAgent(body);
    return NextResponse.json({ decision: backendDecision, warning: errors.filter(Boolean).join(" | ") || undefined });
  } catch (error: any) {
    errors.push(friendlyAiError(error));
  }

  {
    const message = errors.filter(Boolean).join(" | ") || "AI provider unavailable";
    const providerRateLimited = /429|rate.?limit|temporarily/i.test(message);
    if (requireGemma && !providerRateLimited) {
      return NextResponse.json(
        { error: message },
        { status: 502 }
      );
    }

    return NextResponse.json({
      decision: localDecision(body, model),
      warning: message,
    });
  }
}
