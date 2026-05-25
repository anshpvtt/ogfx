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
  mode: "gemma" | "local-demo";
};

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const TEXT_MODEL_FALLBACK = "gemma-4-26b-a4b-it";
const VISION_MODEL_FALLBACK = "gemini-2.5-flash";

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
  const [defaultStrategy, smcStrategy, strategyLibrary, pdfStrategyText, anfxShakuniStrategy] = await Promise.all([
    readJson("strategies/default.json", {}),
    readJson("strategies/smc.json", {}),
    readJson("backend/data/strategies.json", []),
    readText("docs/SMC-STRATEGY.md", ""),
    readJson("strategies/anfx-shakuni.json", {}),
  ]);

  return {
    defaultStrategy,
    smcStrategy,
    strategyLibrary,
    pdfStrategyText,
    anfxShakuniStrategy,
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

function friendlyAiError(error: any) {
  const message = String(error?.message || error || "Google AI provider unavailable");
  if (/unauthorized|401|403|api key/i.test(message)) {
    return "Google AI rejected the API key. OGFX local SMC fallback is active.";
  }
  if (/429|rate.?limit|temporarily|quota/i.test(message)) {
    return "Google AI is temporarily rate-limited. OGFX local SMC fallback is active.";
  }
  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

function configuredModel(needsVision = false) {
  const model = needsVision
    ? process.env.GEMINI_VISION_MODEL || process.env.GOOGLE_GEMINI_VISION_MODEL
    : process.env.GEMMA_MODEL || process.env.GEMINI_MODEL || process.env.GOOGLE_GEMINI_MODEL;
  return model ? model.replace(/^models\//, "") : "";
}

async function resolveGemmaModel(apiKey: string, needsVision = false) {
  const configured = configuredModel(needsVision);
  if (configured) return configured;

  const fallback = needsVision ? VISION_MODEL_FALLBACK : TEXT_MODEL_FALLBACK;
  const response = await fetch(`${GEMINI_ENDPOINT}/models`, {
    headers: { "x-goog-api-key": apiKey },
    next: { revalidate: 3600 },
  });
  if (!response.ok) return fallback;

  const payload = await response.json();
  const models: Array<{ name?: string; supportedGenerationMethods?: string[]; supportedActions?: string[] }> =
    payload?.models ?? [];
  const candidates = models.filter((model) => {
    const methods = model.supportedGenerationMethods ?? model.supportedActions ?? [];
    return methods.includes("generateContent");
  });
  const priorities = needsVision
    ? ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini"]
    : ["gemma-4-26b-a4b-it", "gemma-4-31b-it", "gemma-4", "gemma", "gemini-2.5-flash"];
  const picked = priorities.flatMap((needle) =>
    candidates.filter((model) => (model.name ?? "").toLowerCase().includes(needle))
  )[0];

  return (picked?.name ?? candidates[0]?.name ?? fallback).replace(/^models\//, "");
}

function coerceDecision(value: any, model: string, mode: AgentDecision["mode"]): AgentDecision {
  const rawDecision = value?.decision ?? value?.bias;
  const decision = rawDecision === "BUY" || rawDecision === "SELL" || rawDecision === "WAIT" ? rawDecision : "WAIT";
  const confidence = Math.max(0, Math.min(100, Number(value?.confidence ?? 50)));
  const stopLoss = value?.stopLoss ?? value?.sl;
  const takeProfit = value?.takeProfit ?? value?.tp;
  const rr = typeof value?.rr_ratio === "string"
    ? Number(value.rr_ratio.match(/1\s*:\s*([0-9.]+)/i)?.[1])
    : Number(value?.riskReward ?? value?.rr_ratio ?? value?.rr);
  const summary = value?.summary ?? value?.reason;

  return {
    decision,
    confidence,
    entry: Number.isFinite(Number(value?.entry)) ? Number(value.entry) : null,
    stopLoss: Number.isFinite(Number(stopLoss)) ? Number(stopLoss) : null,
    takeProfit: Number.isFinite(Number(takeProfit)) ? Number(takeProfit) : null,
    riskReward: Number.isFinite(rr) ? rr : null,
    bias: String(value?.bias || "NEUTRAL"),
    summary: String(summary || value?.reasoning || "No high-confidence setup. Wait for cleaner confirmation."),
    reasons: Array.isArray(value?.reasons) ? value.reasons.slice(0, 5).map(String) : [String(value?.reason || "Insufficient confluence")],
    invalidation: String(value?.invalidation || "Setup invalidates if price closes beyond the protected liquidity extreme."),
    model,
    mode,
  };
}

function localDecision(body: any, model = "ogfx-smc-fallback"): AgentDecision {
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
        ? "Local SMC fallback is waiting for stronger confirmation before a demo order."
        : `Local SMC fallback sees ${trend.toLowerCase()} structure with guarded risk levels.`,
    reasons: [
      `Trend state: ${trend}`,
      `Latest change: ${changePct.toFixed(2)}%`,
      `ATR volatility: ${volatility.toFixed(2)}%`,
      "SMC guardrails require TP/SL before any demo execution",
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
    throw new Error(`Google AI returned ${response.status}: ${raw.slice(0, 220)}`);
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
  const normalizeParsed = (parsed: any) => Array.isArray(parsed) ? parsed[0] ?? {} : parsed;

  try {
    return normalizeParsed(JSON.parse(cleaned));
  } catch {
    const fenced = [...cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    for (let index = fenced.length - 1; index >= 0; index -= 1) {
      try {
        return normalizeParsed(JSON.parse(fenced[index]?.[1]?.trim() || "{}"));
      } catch {
        // Keep searching below.
      }
    }

    const parsedObjects: any[] = [];
    for (let start = 0; start < cleaned.length; start += 1) {
      if (cleaned[start] !== "{") continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < cleaned.length; index += 1) {
        const char = cleaned[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === "\"") inString = false;
          continue;
        }
        if (char === "\"") inString = true;
        else if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            try {
              parsedObjects.push(normalizeParsed(JSON.parse(cleaned.slice(start, index + 1))));
              start = index;
            } catch {
              // Ignore non-JSON brace blocks in model commentary.
            }
            break;
          }
        }
      }
    }

    if (parsedObjects.length) {
      return parsedObjects[parsedObjects.length - 1];
    }
    throw new Error("Google AI returned non-JSON analysis");
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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const assetId = String(body?.assetId ?? body?.pair ?? body?.symbol ?? "").toUpperCase();
  const asset = getTradingAsset(assetId);

  if (!body || !asset) {
    return NextResponse.json({ error: "Invalid analysis request" }, { status: 400 });
  }

  const datasets = await loadDatasets();
  const geminiApiKey = getGeminiApiKey();
  const imageParts = toImageParts(body);
  const model = geminiApiKey
    ? await resolveGemmaModel(geminiApiKey, imageParts.length > 0)
    : imageParts.length > 0 ? VISION_MODEL_FALLBACK : TEXT_MODEL_FALLBACK;
  const requireGemma = Boolean(body.requireGemma);
  const prompt = [
    "You are an elite SMC trading analyst for OGFX demo trading. Use Gemma reasoning, ANFX LSBR rules, Shakuni trap rules, uploaded PDFs/transcripts, and the live chart data. Do not claim certainty and do not provide financial advice.",
    "ANALYSIS FRAMEWORK: 1) Market Structure: BOS or MSS. 2) Liquidity: sweep of swing highs/lows. 3) Displacement: impulsive candle after sweep. 4) POI: OB/FVG/supply/demand retest. 5) Confirmation: rejection or mitigation at POI.",
    "STRICT RULES: BUY only if liquidity swept below + bullish MSS/BOS + demand OB/FVG retest. SELL only if liquidity swept above + bearish MSS/BOS + supply OB/FVG retest. If unclear, return NO_TRADE. Never force a trade.",
    "Return strict JSON only with keys: bias, confidence, entry, sl, tp, rr_ratio, reasoning, setup_type, liquidity_swept, structure_confirmed.",
    "Allowed bias values: BUY, SELL, NO_TRADE. Confidence must be 0-100. TP/SL must be numeric for BUY/SELL and 0 for NO_TRADE. Reasoning must mention setup logic and capital/risk suitability.",
    imageParts.length ? "Attached image(s) are live chart screenshots. Read market structure, candles, liquidity, zones, trend, and visible price action from them, but only trade if the OGFX strategy rules agree." : "",
    `Asset: ${asset.id} (${asset.name})`,
    `Timeframe: ${body.interval ?? body.timeframe ?? "15"}`,
    `Market snapshot: ${JSON.stringify(body.snapshot ?? null).slice(0, 7000)}`,
    `Demo account: ${JSON.stringify(body.account ?? null).slice(0, 2500)}`,
    `Demo settings/risk profile: ${JSON.stringify(body.settings ?? body.riskProfile ?? null).slice(0, 2500)}`,
    `Required OGFX strategy logic: ${JSON.stringify(body.strategyLogic ?? null).slice(0, 6000)}`,
    `Open demo orders: ${JSON.stringify(body.openOrders ?? []).slice(0, 2500)}`,
    `Pending demo orders: ${JSON.stringify(body.pendingOrders ?? []).slice(0, 2500)}`,
    `Active selected order: ${JSON.stringify(body.activeOrder ?? null).slice(0, 1800)}`,
    `Recent demo history: ${JSON.stringify(body.history ?? []).slice(0, 2500)}`,
    `Recent saved signals: ${JSON.stringify(body.recentSignals ?? []).slice(0, 2500)}`,
    `Datasets: ${JSON.stringify(datasets).slice(0, 9000)}`,
  ].join("\n\n");

  if (!geminiApiKey) {
    if (requireGemma) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is required for Google AI signal generation" },
        { status: 503 }
      );
    }

    return NextResponse.json({
      decision: localDecision(body, model),
      warning: "No server-side Google AI key configured. Using deterministic local SMC fallback.",
    });
  }

  try {
    const rawDecision = await callGemma({ apiKey: geminiApiKey, model, prompt, imageParts });
    return NextResponse.json({ decision: coerceDecision(rawDecision, model, "gemma") });
  } catch (error: any) {
    const message = friendlyAiError(error);
    if (requireGemma && !/429|rate.?limit|temporarily|quota/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json({
      decision: localDecision(body, model),
      warning: message,
    });
  }
}
