import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const TEXT_MODEL_FALLBACK = "gemma-4-26b-a4b-it";
const VISION_MODEL_FALLBACK = "gemini-2.5-flash";
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

function configuredModel(needsVision = false) {
  const model = needsVision
    ? process.env.GEMINI_VISION_MODEL || process.env.GOOGLE_GEMINI_VISION_MODEL
    : process.env.GEMMA_MODEL || process.env.GEMINI_MODEL || process.env.GOOGLE_GEMINI_MODEL;
  return model ? stripModelName(model) : "";
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
  const normalizeParsed = (parsed) => Array.isArray(parsed) ? parsed[0] ?? {} : parsed;

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

    const parsedObjects = [];
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

function numeric(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function confidenceNumber(value, fallback = 50) {
  if (typeof value === "string") {
    if (value.toUpperCase() === "HIGH") return 78;
    if (value.toUpperCase() === "MEDIUM") return 64;
    if (value.toUpperCase() === "LOW") return 48;
  }
  return Math.max(0, Math.min(100, numeric(value, fallback)));
}

function coerceDecision(value, model, mode = "gemini") {
  const rawDecision = value?.decision ?? value?.bias;
  const decision = rawDecision === "BUY" || rawDecision === "SELL" || rawDecision === "WAIT"
    ? rawDecision
    : "WAIT";
  const stopLoss = value?.stopLoss ?? value?.sl;
  const takeProfit = value?.takeProfit ?? value?.tp;
  const rr = typeof value?.rr_ratio === "string"
    ? Number(value.rr_ratio.match(/1\s*:\s*([0-9.]+)/i)?.[1])
    : Number(value?.riskReward ?? value?.rr_ratio ?? value?.rr);
  const summary = value?.summary ?? value?.reason;

  return {
    decision,
    confidence: confidenceNumber(value?.confidence, 50),
    entry: numeric(value?.entry, null),
    stopLoss: numeric(stopLoss, null),
    takeProfit: numeric(takeProfit, null),
    riskReward: numeric(rr, null),
    bias: String(value?.bias || "NEUTRAL"),
    summary: String(summary || value?.reasoning || "No high-confidence setup. Wait for cleaner confirmation."),
    reasons: Array.isArray(value?.reasons) ? value.reasons.slice(0, 6).map(String) : [String(value?.reason || "Insufficient confluence")],
    invalidation: String(value?.invalidation || "Invalid if price closes beyond the protected liquidity extreme."),
    model,
    mode,
  };
}

function localDecision(body = {}, model = "ogfx-smc-fallback", warning = "") {
  const signal = body.engineResult?.signal || body.analysis?.signal || body.engineResult || {};
  const rawDirection = signal.signal || signal.direction || signal.decision;
  const latest = body.snapshot?.latest;
  const close = numeric(latest?.close ?? body.price, 0);
  const atr = numeric(body.snapshot?.atr, close * 0.004);
  const trend = String(body.snapshot?.trend || signal.bias || "NEUTRAL").toUpperCase();
  const changePct = numeric(body.snapshot?.dayChangePct, 0);
  const engineDecision = rawDirection === "BUY" || rawDirection === "SELL" ? rawDirection : null;
  const shouldBuy = trend === "BULLISH" && changePct >= -0.2;
  const shouldSell = trend === "BEARISH" && changePct <= 0.2;
  const decision = engineDecision || (shouldBuy ? "BUY" : shouldSell ? "SELL" : "WAIT");
  const stopDistance = atr > 0 ? atr * 1.4 : close * 0.004;
  const targetDistance = stopDistance * 2;
  const entry = numeric(signal.entry, close || null);
  const stopLoss = numeric(signal.stopLoss ?? signal.sl, entry ? (decision === "SELL" ? entry + stopDistance : entry - stopDistance) : null);
  const takeProfit = numeric(signal.takeProfit ?? signal.tp, entry ? (decision === "SELL" ? entry - targetDistance : entry + targetDistance) : null);

  return {
    decision,
    confidence: decision === "WAIT" ? 54 : confidenceNumber(signal.confidence, 68),
    entry: entry ? Number(entry.toFixed(entry > 20 ? 2 : 5)) : null,
    stopLoss: stopLoss ? Number(stopLoss.toFixed(stopLoss > 20 ? 2 : 5)) : null,
    takeProfit: takeProfit ? Number(takeProfit.toFixed(takeProfit > 20 ? 2 : 5)) : null,
    riskReward: numeric(signal.riskReward ?? signal.rr, decision === "WAIT" ? null : 2),
    bias: trend,
    summary:
      decision === "WAIT"
        ? "Local SMC fallback is waiting for stronger confirmation before a demo order."
        : `Local SMC fallback sees ${trend.toLowerCase()} structure with guarded risk levels.`,
    reasons: [
      `Trend state: ${trend}`,
      `Latest change: ${changePct.toFixed(2)}%`,
      "SMC fallback used after Google AI was unavailable or not configured",
    ],
    invalidation: "Invalidate if price closes through the stop-loss side before confirmation.",
    model,
    mode: "local-demo",
    ...(warning ? { warning } : {}),
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
        readJson("strategies/anfx-shakuni.json", {}),
      ]).then(([defaultStrategy, smcStrategy, strategyLibrary, pdfStrategyText, anfxShakuniStrategy]) => ({
        defaultStrategy,
        smcStrategy,
        strategyLibrary,
        pdfStrategyText,
        anfxShakuniStrategy,
      }));
    }

    return this.datasetPromise;
  }

  async resolveModel(needsVision = false) {
    const configured = configuredModel(needsVision);
    if (configured) return configured;

    const fallback = needsVision ? VISION_MODEL_FALLBACK : TEXT_MODEL_FALLBACK;
    const key = apiKey();
    if (!key) return fallback;

    const cacheKey = needsVision ? "vision" : "text";
    if (this.modelCache.has(cacheKey)) return this.modelCache.get(cacheKey);

    const response = await fetch(`${GEMINI_ENDPOINT}/models`, {
      headers: { "x-goog-api-key": key },
    });

    if (!response.ok) {
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
      : ["gemma-4-26b-a4b-it", "gemma-4-31b-it", "gemma-4", "gemma", "gemini-2.5-flash"];
    const picked = priorities.flatMap((needle) =>
      candidates.filter((model) => (model.name ?? "").toLowerCase().includes(needle))
    )[0];
    const resolved = stripModelName(picked?.name ?? candidates[0]?.name ?? fallback);
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
    const imageParts = toImageParts(body);
    const model = await this.resolveModel(imageParts.length > 0);

    if (!key) {
      return localDecision(body, model, "No server-side Google AI key configured.");
    }

    const datasets = await this.datasets();
    const prompt = [
      "You are an elite SMC trading analyst for OGFX demo trading. Use Gemma reasoning, ANFX LSBR rules, Shakuni trap rules, uploaded PDFs/transcripts, and the live chart data. Do not claim certainty and do not provide financial advice.",
      "ANALYSIS FRAMEWORK: 1) Market Structure: BOS or MSS. 2) Liquidity: sweep of swing highs/lows. 3) Displacement: impulsive candle after sweep. 4) POI: OB/FVG/supply/demand retest. 5) Confirmation: rejection or mitigation at POI.",
      "STRICT RULES: BUY only if liquidity swept below + bullish MSS/BOS + demand OB/FVG retest. SELL only if liquidity swept above + bearish MSS/BOS + supply OB/FVG retest. If unclear, return NO_TRADE. Never force a trade.",
      "Return strict JSON only with keys: bias, confidence, entry, sl, tp, rr_ratio, reasoning, setup_type, liquidity_swept, structure_confirmed.",
      "Allowed bias values: BUY, SELL, NO_TRADE. Confidence must be 0-100. TP/SL must be numeric for BUY/SELL and 0 for NO_TRADE. Reasoning must mention setup logic and capital/risk suitability.",
      imageParts.length ? "Attached image(s) are live chart screenshots. Read visible market structure, liquidity sweeps, candles, zones, and price action from the image." : "",
      `Asset: ${body.assetId || body.symbol || "UNKNOWN"}`,
      `Timeframe: ${body.timeframe || body.interval || "15m"}`,
      `Market snapshot: ${JSON.stringify(body.snapshot ?? null).slice(0, 7000)}`,
      `Engine result: ${JSON.stringify(body.engineResult ?? null).slice(0, 5000)}`,
      `Demo account: ${JSON.stringify(body.account ?? null).slice(0, 2500)}`,
      `Demo settings/risk profile: ${JSON.stringify(body.settings ?? body.riskProfile ?? null).slice(0, 2500)}`,
      `Open demo orders: ${JSON.stringify(body.openOrders ?? []).slice(0, 2500)}`,
      `Pending demo orders: ${JSON.stringify(body.pendingOrders ?? []).slice(0, 2500)}`,
      `Active selected order: ${JSON.stringify(body.activeOrder ?? null).slice(0, 1800)}`,
      `Recent history: ${JSON.stringify(body.history ?? []).slice(0, 2500)}`,
      `Required OGFX datasets and PDF strategy logic: ${JSON.stringify(datasets).slice(0, 11000)}`,
    ].join("\n\n");

    try {
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
        throw new Error(`Google AI returned ${response.status}: ${raw.slice(0, 220)}`);
      }

      const payload = JSON.parse(raw || "{}");
      const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") ?? "{}";
      return coerceDecision(parseJson(text), model, "gemini");
    } catch (error) {
      return localDecision(body, model, String(error?.message || error));
    }
  }
}
