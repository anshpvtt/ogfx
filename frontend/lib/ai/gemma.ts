export type AiProvider = "gemini";

export type ChecklistItem = {
  label: string;
  status: "pass" | "pending" | "fail";
};

export type StructuredSmcAnalysis = {
  bias: "BUY" | "SELL" | "WAIT";
  confidence: number;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  rr_ratio: number | null;
  setup_type: string;
  reasoning: string;
  strategy_alignment: string;
  checklist: ChecklistItem[];
  gemma_analysis: string;
  provider: AiProvider | "local";
  model: string;
  warning?: string;
};

export type GeminiImageInput =
  | string
  | {
      data?: string;
      dataUrl?: string;
      mimeType?: string;
      mime_type?: string;
    };

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const TEXT_MODEL_FALLBACK = "gemma-4-26b-a4b-it";
const VISION_MODEL_FALLBACK = "gemini-2.5-flash";

const modelCache = new Map<string, string>();

function geminiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    ""
  );
}

function stripModelName(model: string) {
  return String(model || "").replace(/^models\//, "");
}

function configuredModel(needsVision = false) {
  const model = needsVision
    ? process.env.GEMINI_VISION_MODEL || process.env.GOOGLE_GEMINI_VISION_MODEL
    : process.env.GEMMA_MODEL || process.env.GEMINI_MODEL || process.env.GOOGLE_GEMINI_MODEL;
  return model ? stripModelName(model) : "";
}

async function resolveGoogleModel(needsVision = false) {
  const configured = configuredModel(needsVision);
  if (configured) return configured;

  const cacheKey = needsVision ? "vision" : "text";
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const fallback = needsVision ? VISION_MODEL_FALLBACK : TEXT_MODEL_FALLBACK;
  const key = geminiKey();
  if (!key) return fallback;

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}/models`, {
      headers: { "x-goog-api-key": key },
      next: { revalidate: 3600 },
    });
    if (!response.ok) throw new Error(`Models API returned ${response.status}`);

    const payload = await response.json();
    const models: Array<{ name?: string; supportedGenerationMethods?: string[]; supportedActions?: string[] }> =
      Array.isArray(payload?.models) ? payload.models : [];
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
    modelCache.set(cacheKey, resolved);
    return resolved;
  } catch {
    modelCache.set(cacheKey, fallback);
    return fallback;
  }
}

export function friendlyAiError(error: unknown) {
  const message = String((error as any)?.message || error || "Google AI provider unavailable");
  if (/429|rate.?limit|temporarily|quota/i.test(message)) {
    return "Google AI is rate-limited right now. OGFX is using the local SMC fallback until requests are accepted again.";
  }
  if (/401|403|unauthorized|forbidden|api key/i.test(message)) {
    return "Google AI rejected the server API key. Check the deployment environment variable.";
  }
  return message.length > 260 ? `${message.slice(0, 257)}...` : message;
}

function parseJson(text: string) {
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
    throw new Error("Google AI returned non-JSON output");
  }
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rrOrNull(value: unknown) {
  if (typeof value === "string") {
    const match = value.match(/1\s*:\s*([0-9.]+)/i);
    if (match) return numberOrNull(match[1]);
  }
  return numberOrNull(value);
}

function side(value: unknown): StructuredSmcAnalysis["bias"] {
  return value === "BUY" || value === "SELL" || value === "WAIT" ? value : "WAIT";
}

export function normalizeSmcAnalysis(value: any, provider: StructuredSmcAnalysis["provider"], model: string): StructuredSmcAnalysis {
  const rawBias = value?.bias ?? value?.decision ?? value?.signal;
  const bias = rawBias === "NO_TRADE" ? "WAIT" : side(rawBias);
  const stopLoss = value?.stop_loss ?? value?.stopLoss ?? value?.sl;
  const takeProfit = value?.take_profit ?? value?.takeProfit ?? value?.tp;
  const rr = value?.rr_ratio ?? value?.riskReward ?? value?.risk_reward ?? value?.rr;
  const checklist = Array.isArray(value?.checklist)
    ? value.checklist.slice(0, 8).map((item: any) => ({
        label: String(item?.label || item || "Checklist item").slice(0, 140),
        status: item?.status === "fail" || item?.status === "pending" ? item.status : "pass",
      }))
    : [
        { label: "Market bias selected", status: bias === "WAIT" ? "pending" : "pass" },
        { label: "Liquidity swept", status: value?.liquidity_swept === true ? "pass" : "pending" },
        { label: "Structure confirmed", status: value?.structure_confirmed === true ? "pass" : "pending" },
        { label: "TP/SL defined", status: numberOrNull(stopLoss) && numberOrNull(takeProfit) ? "pass" : "pending" },
        { label: "ANFX/Shakuni rules reviewed", status: "pass" },
      ];

  const confidence = Math.max(0, Math.min(100, Math.round(Number(value?.confidence ?? (bias === "WAIT" ? 45 : 70)))));
  const reasoning = String(value?.reasoning || value?.summary || value?.reason || "No complete setup explanation returned.").slice(0, 2000);
  const strategyAlignment = String(
    value?.strategy_alignment ||
    value?.strategyAlignment ||
    `Compared against ANFX/Shakuni LSBR rules: liquidity_swept=${Boolean(value?.liquidity_swept)}, structure_confirmed=${Boolean(value?.structure_confirmed)}.`
  ).slice(0, 1200);

  return {
    bias,
    confidence,
    entry: numberOrNull(value?.entry),
    stop_loss: numberOrNull(stopLoss),
    take_profit: numberOrNull(takeProfit),
    rr_ratio: rrOrNull(rr),
    setup_type: String(value?.setup_type || value?.setupType || (bias === "WAIT" ? "NO_SETUP" : "SMC confluence")).slice(0, 180),
    reasoning,
    strategy_alignment: strategyAlignment,
    checklist,
    gemma_analysis: String(value?.gemma_analysis || value?.gemmaAnalysis || reasoning).slice(0, 4000),
    provider,
    model,
  };
}

function geminiImageParts(images?: GeminiImageInput | GeminiImageInput[]) {
  const sources = Array.isArray(images) ? images : images ? [images] : [];
  return sources.flatMap((source) => {
    if (!source) return [];

    if (typeof source === "object") {
      const value = String(source.dataUrl || source.data || "");
      if (!value) return [];
      const match = value.match(/^data:([^;]+);base64,(.+)$/);
      return [{
        inline_data: {
          mime_type: String(source.mimeType || source.mime_type || match?.[1] || "image/png"),
          data: match?.[2] || value,
        },
      }];
    }

    const value = String(source);
    const match = value.match(/^data:([^;]+);base64,(.+)$/);
    return [{
      inline_data: {
        mime_type: match?.[1] || "image/png",
        data: match?.[2] || value,
      },
    }];
  });
}

async function callGemini(systemPrompt: string, userMessage: string, imageDataUrl?: string, temperature = 0.15) {
  const model = await resolveGoogleModel(Boolean(imageDataUrl));
  const key = geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY is not configured");

  const response = await fetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userMessage}` }, ...geminiImageParts(imageDataUrl)] }],
      generationConfig: { temperature, responseMimeType: "application/json" },
    }),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Google AI returned ${response.status}: ${raw.slice(0, 500)}`);
  const payload = JSON.parse(raw || "{}");
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join("") ?? "{}";
  return { value: parseJson(text), provider: "gemini" as const, model };
}

export async function callGemmaAnalysis(params: {
  systemPrompt: string;
  userMessage: string;
  imageDataUrl?: string;
}) {
  const result = await callGemini(params.systemPrompt, params.userMessage, params.imageDataUrl);
  return normalizeSmcAnalysis(result.value, result.provider, result.model);
}

export async function callGemmaText(systemPrompt: string, userMessage: string) {
  const model = await resolveGoogleModel(false);
  const key = geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY is not configured");

  const response = await fetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }],
      generationConfig: { temperature: 0.35 },
    }),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Google AI returned ${response.status}: ${raw.slice(0, 500)}`);
  const payload = JSON.parse(raw || "{}");
  const content = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join("") ?? "";
  return { content, provider: "gemini" as const, model };
}

export async function callGemmaCoach(params: {
  systemPrompt: string;
  userMessage: string;
  images?: GeminiImageInput[];
  temperature?: number;
}) {
  const imageParts = geminiImageParts(params.images);
  const model = await resolveGoogleModel(imageParts.length > 0);
  const key = geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY is not configured");

  const response = await fetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: `${params.systemPrompt}\n\n${params.userMessage}` }, ...imageParts],
      }],
      generationConfig: {
        temperature: params.temperature ?? 0.25,
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Google AI returned ${response.status}: ${raw.slice(0, 500)}`);
  const payload = JSON.parse(raw || "{}");
  const content = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join("") ?? "";
  return { content, provider: "gemini" as const, model };
}
