import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function repoRoot() {
  return path.resolve(__dirname, "../../..");
}

async function readText(relativePath, fallback = "") {
  try {
    return await readFile(path.join(repoRoot(), relativePath), "utf8");
  } catch {
    return fallback;
  }
}

async function readJson(relativePath, fallback = null) {
  const raw = await readText(relativePath, "");
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function apiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    ""
  );
}

function stripModelName(model) {
  return String(model || "").replace(/^models\//, "");
}

function toImageParts(body = {}) {
  const sources = Array.isArray(body.images)
    ? body.images
    : [body.imageDataUrl || body.imageBase64].filter(Boolean);

  return sources.flatMap((source) => {
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
        mime_type: match?.[1] || body.imageMimeType || "image/png",
        data: match?.[2] || value,
      },
    }];
  });
}

function parseJson(text) {
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
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Gemini returned non-JSON analysis");
  }
}

function coerceDecision(value, model) {
  const decision = value?.decision === "BUY" || value?.decision === "SELL" || value?.decision === "WAIT"
    ? value.decision
    : "WAIT";

  return {
    decision,
    confidence: Math.max(0, Math.min(100, Number(value?.confidence ?? 50))),
    entry: Number.isFinite(Number(value?.entry)) ? Number(value.entry) : null,
    stopLoss: Number.isFinite(Number(value?.stopLoss)) ? Number(value.stopLoss) : null,
    takeProfit: Number.isFinite(Number(value?.takeProfit)) ? Number(value.takeProfit) : null,
    riskReward: Number.isFinite(Number(value?.riskReward)) ? Number(value.riskReward) : null,
    bias: String(value?.bias || "NEUTRAL"),
    summary: String(value?.summary || "No high-confidence setup. Wait for cleaner confirmation."),
    reasons: Array.isArray(value?.reasons) ? value.reasons.slice(0, 6).map(String) : ["Insufficient confluence"],
    invalidation: String(value?.invalidation || "Invalid if price closes beyond the protected liquidity extreme."),
    model,
    mode: "gemini",
  };
}

export class GeminiAnalyzer {
  constructor() {
    this.datasetPromise = null;
    this.modelCache = new Map();
  }

  async datasets() {
    if (!this.datasetPromise) {
      this.datasetPromise = Promise.all([
        readJson("strategies/default.json", {}),
        readJson("strategies/smc.json", {}),
        readJson("backend/data/strategies.json", []),
        readText("docs/SMC-STRATEGY.md", ""),
      ]).then(([defaultStrategy, smcStrategy, strategyLibrary, pdfStrategyText]) => ({
        defaultStrategy,
        smcStrategy,
        strategyLibrary,
        pdfStrategyText,
      }));
    }

    return this.datasetPromise;
  }

  async resolveModel(needsVision = false) {
    const configured = process.env.GEMINI_MODEL || process.env.GOOGLE_GEMINI_MODEL;
    if (configured && !(needsVision && configured.toLowerCase().includes("gemma"))) {
      return stripModelName(configured);
    }

    const key = apiKey();
    if (!key) throw new Error("GEMINI_API_KEY is required");

    const cacheKey = needsVision ? "vision" : "text";
    if (this.modelCache.has(cacheKey)) return this.modelCache.get(cacheKey);

    const response = await fetch(`${GEMINI_ENDPOINT}/models`, {
      headers: { "x-goog-api-key": key },
    });

    if (!response.ok) {
      const fallback = "gemini-2.5-flash";
      this.modelCache.set(cacheKey, fallback);
      return fallback;
    }

    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models : [];
    const candidates = models.filter((model) => {
      const methods = model.supportedGenerationMethods ?? model.supportedActions ?? [];
      return methods.includes("generateContent");
    });
    const priorities = needsVision
      ? ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini"]
      : ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini"];
    const picked = priorities.flatMap((needle) =>
      candidates.filter((model) => (model.name ?? "").toLowerCase().includes(needle))
    )[0];
    const resolved = stripModelName(picked?.name ?? candidates[0]?.name ?? "gemini-2.5-flash");
    this.modelCache.set(cacheKey, resolved);
    return resolved;
  }

  snapshotFromMarket(symbol, timeframe, market) {
    const candles = Array.isArray(market?.candles) ? market.candles : [];
    const latest = candles.at(-1);
    const previous = candles.at(-2);
    const close = Number(latest?.close ?? market?.close ?? 0);
    const previousClose = Number(previous?.close ?? close);
    const atr = Number(market?.indicators?.atr?.[14] ?? latest?.indicators?.atr?.[14] ?? close * 0.004);
    const ema20 = Number(market?.indicators?.ema?.[20] ?? latest?.indicators?.ema?.[20] ?? close);
    const ema50 = Number(market?.indicators?.ema?.[50] ?? latest?.indicators?.ema?.[50] ?? close);

    return {
      assetId: symbol,
      timeframe,
      provider: market?.provider ?? "unknown",
      latest: latest ? {
        time: latest.timestamp ? new Date(latest.timestamp).toISOString() : new Date().toISOString(),
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
        volume: latest.volume ?? 0,
      } : null,
      dayChange: close - previousClose,
      dayChangePct: previousClose ? ((close - previousClose) / previousClose) * 100 : 0,
      trend: ema20 > ema50 ? "BULLISH" : ema20 < ema50 ? "BEARISH" : "NEUTRAL",
      ema20,
      ema50,
      atr,
      levels: market?.levels ?? null,
      candles: candles.slice(-80),
    };
  }

  async analyze(body = {}) {
    const key = apiKey();
    if (!key) throw new Error("GEMINI_API_KEY is required");

    const imageParts = toImageParts(body);
    const model = await this.resolveModel(imageParts.length > 0);
    const datasets = await this.datasets();
    const prompt = [
      "You are OGFX Agent, a demo-only Smart Money Concepts trading analyst. Do not claim certainty and do not provide financial advice.",
      "Return strict JSON only with keys: decision, confidence, entry, stopLoss, takeProfit, riskReward, bias, summary, reasons, invalidation.",
      "Allowed decision values: BUY, SELL, WAIT. TP and SL must be numeric for BUY or SELL. Prefer WAIT when confluence is incomplete.",
      imageParts.length ? "Attached image(s) are chart screenshots. Read visible market structure, liquidity sweeps, candles, zones, and price action from the image." : "",
      `Asset: ${body.assetId || body.symbol || "UNKNOWN"}`,
      `Timeframe: ${body.timeframe || body.interval || "15m"}`,
      `Market snapshot: ${JSON.stringify(body.snapshot ?? null).slice(0, 7000)}`,
      `Engine result: ${JSON.stringify(body.engineResult ?? null).slice(0, 5000)}`,
      `Open demo orders: ${JSON.stringify(body.openOrders ?? []).slice(0, 2000)}`,
      `Recent history: ${JSON.stringify(body.history ?? []).slice(0, 2000)}`,
      `Required OGFX datasets and PDF strategy logic: ${JSON.stringify(datasets).slice(0, 11000)}`,
    ].join("\n\n");

    const response = await fetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini returned ${response.status}: ${raw.slice(0, 220)}`);
    }

    const payload = JSON.parse(raw || "{}");
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") ?? "{}";
    return coerceDecision(parseJson(text), model);
  }
}
