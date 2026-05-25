import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OLLAMA_ENDPOINT = "https://ollama.com/api/chat";
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

function openRouterApiKey() {
  return process.env.OPENROUTER_API_KEY || "";
}

function openRouterModel() {
  return process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
}

function ollamaApiKey() {
  return process.env.OLLAMA_API_KEY || "";
}

function ollamaModel(needsVision = false) {
  if (needsVision) return process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MODEL || "qwen3-vl:235b-instruct";
  return process.env.OLLAMA_MODEL || "gemma4:31b";
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

function toOpenRouterImageParts(body = {}) {
  const sources = Array.isArray(body.images)
    ? body.images
    : [body.imageDataUrl || body.imageBase64].filter(Boolean);

  return sources.flatMap((source) => {
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
        url: value.startsWith("data:") ? value : `data:${body.imageMimeType || "image/png"};base64,${value}`,
      },
    }];
  });
}

function toOllamaImages(body = {}) {
  const sources = Array.isArray(body.images)
    ? body.images
    : [body.imageDataUrl || body.imageBase64].filter(Boolean);

  return sources.flatMap((source) => {
    if (!source) return [];
    if (typeof source === "object" && source.data) {
      return [String(source.data).replace(/^data:[^;]+;base64,/, "")];
    }

    return [String(source).replace(/^data:[^;]+;base64,/, "")];
  });
}

function parseJson(text) {
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
    throw new Error("Gemini returned non-JSON analysis");
  }
}

function coerceDecision(value, model, mode = "gemini") {
  const decision = value?.decision === "BUY" || value?.decision === "SELL" || value?.decision === "WAIT"
    ? value.decision
    : "WAIT";
  const stopLoss = value?.stopLoss ?? value?.sl;
  const takeProfit = value?.takeProfit ?? value?.tp;
  const summary = value?.summary ?? value?.reason;

  return {
    decision,
    confidence: Math.max(0, Math.min(100, Number(value?.confidence ?? 50))),
    entry: Number.isFinite(Number(value?.entry)) ? Number(value.entry) : null,
    stopLoss: Number.isFinite(Number(stopLoss)) ? Number(stopLoss) : null,
    takeProfit: Number.isFinite(Number(takeProfit)) ? Number(takeProfit) : null,
    riskReward: Number.isFinite(Number(value?.riskReward ?? value?.rr)) ? Number(value?.riskReward ?? value?.rr) : null,
    bias: String(value?.bias || "NEUTRAL"),
    summary: String(summary || "No high-confidence setup. Wait for cleaner confirmation."),
    reasons: Array.isArray(value?.reasons) ? value.reasons.slice(0, 6).map(String) : [String(value?.reason || "Insufficient confluence")],
    invalidation: String(value?.invalidation || "Invalid if price closes beyond the protected liquidity extreme."),
    model,
    mode,
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
    const ollamaKey = ollamaApiKey();
    const openRouterKey = openRouterApiKey();
    const key = apiKey();
    if (!ollamaKey && !openRouterKey && !key) throw new Error("OLLAMA_API_KEY, OPENROUTER_API_KEY, or GEMINI_API_KEY is required");

    const imageParts = toImageParts(body);
    const ollamaImages = toOllamaImages(body);
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

    const errors = [];
    if (openRouterKey) {
      const model = openRouterModel();
      try {
        const response = await fetch(OPENROUTER_ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.PUBLIC_APP_URL || "https://ogfx-frontend.vercel.app",
            "X-Title": "OGFX Elite SMC Trading Engine",
          },
          body: JSON.stringify({
            model,
            messages: [{
              role: "user",
              content: toOpenRouterImageParts(body).length
                ? [{ type: "text", text: prompt }, ...toOpenRouterImageParts(body)]
                : prompt,
            }],
            temperature: 0.1,
            max_tokens: 800,
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
          ? content.map((part) => part?.text || "").join("")
          : String(content || "{}");
        return coerceDecision(parseJson(text), model, "openrouter");
      } catch (error) {
        errors.push(String(error?.message || error));
      }
    }

    if (ollamaKey) {
      const model = ollamaModel(ollamaImages.length > 0);
      try {
        const response = await fetch(OLLAMA_ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${ollamaKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [{
              role: "user",
              content: prompt,
              ...(ollamaImages.length ? { images: ollamaImages } : {}),
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
        return coerceDecision(parseJson(text), model, "ollama");
      } catch (error) {
        errors.push(String(error?.message || error));
      }
    }

    if (!key) {
      throw new Error(errors[0] || "AI provider unavailable and GEMINI_API_KEY is not configured");
    }

    const model = await this.resolveModel(imageParts.length > 0);
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
    return coerceDecision(parseJson(text), model, "gemini");
  }
}
