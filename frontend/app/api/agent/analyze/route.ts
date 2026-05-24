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

async function readJson(relativePath: string) {
  const root = path.basename(process.cwd()) === "frontend" ? path.resolve(process.cwd(), "..") : process.cwd();
  const raw = await readFile(path.join(root, relativePath), "utf8");
  return JSON.parse(raw);
}

async function readText(relativePath: string) {
  const root = path.basename(process.cwd()) === "frontend" ? path.resolve(process.cwd(), "..") : process.cwd();
  return readFile(path.join(root, relativePath), "utf8");
}

async function loadDatasets() {
  const [defaultStrategy, smcStrategy, strategyLibrary, pdfStrategyText] = await Promise.all([
    readJson("strategies/default.json"),
    readJson("strategies/smc.json"),
    readJson("backend/data/strategies.json"),
    readText("docs/SMC-STRATEGY.md").catch(() => ""),
  ]);

  return {
    defaultStrategy,
    smcStrategy,
    strategyLibrary,
    pdfStrategyText,
  };
}

function getApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    ""
  );
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

  return {
    decision,
    confidence,
    entry: Number.isFinite(Number(value?.entry)) ? Number(value.entry) : null,
    stopLoss: Number.isFinite(Number(value?.stopLoss)) ? Number(value.stopLoss) : null,
    takeProfit: Number.isFinite(Number(value?.takeProfit)) ? Number(value.takeProfit) : null,
    riskReward: Number.isFinite(Number(value?.riskReward)) ? Number(value.riskReward) : null,
    bias: String(value?.bias || "NEUTRAL"),
    summary: String(value?.summary || "No high-confidence setup. Wait for cleaner confirmation."),
    reasons: Array.isArray(value?.reasons) ? value.reasons.slice(0, 5).map(String) : ["Insufficient confluence"],
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
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const assetId = String(body?.assetId ?? "").toUpperCase();
  const asset = getTradingAsset(assetId);

  if (!body || !asset) {
    return NextResponse.json({ error: "Invalid analysis request" }, { status: 400 });
  }

  const datasets = await loadDatasets();
  const apiKey = getApiKey();
  const imageParts = toImageParts(body);
  const model = apiKey ? await resolveGemmaModel(apiKey, imageParts.length > 0) : "gemma-4";
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

  if (!apiKey) {
    if (requireGemma) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is required for production signal generation" },
        { status: 503 }
      );
    }

    return NextResponse.json({
      decision: localDecision(body, model),
      warning: "No server-side Gemini API key configured. Using deterministic local demo agent.",
    });
  }

  try {
    const rawDecision = await callGemma({ apiKey, model, prompt, imageParts });
    return NextResponse.json({ decision: coerceDecision(rawDecision, model, "gemma") });
  } catch (error: any) {
    if (requireGemma) {
      return NextResponse.json(
        { error: error?.message || "Gemma analysis failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      decision: localDecision(body, model),
      warning: error?.message || "Gemma analysis failed. Using local demo agent.",
    });
  }
}
