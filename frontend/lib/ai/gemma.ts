export type AiProvider = "openrouter" | "ollama" | "gemini";

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

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OLLAMA_ENDPOINT = "https://ollama.com/api/chat";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

function openRouterKey() {
  return process.env.OPENROUTER_API_KEY || "";
}

function openRouterModel() {
  return process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free";
}

function ollamaKey() {
  return process.env.OLLAMA_API_KEY || "";
}

function ollamaModel(needsVision = false) {
  if (needsVision) return process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MODEL || "qwen3-vl:235b-instruct";
  return process.env.OLLAMA_MODEL || "gemma4:31b";
}

function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
}

function geminiModel(needsVision = false) {
  return (
    process.env.GEMINI_MODEL ||
    process.env.GOOGLE_GEMINI_MODEL ||
    (needsVision ? "gemini-2.5-flash" : "gemma-4")
  ).replace(/^models\//, "");
}

export function friendlyAiError(error: unknown) {
  const message = String((error as any)?.message || error || "AI provider unavailable");
  if (/free-models-per-day/i.test(message)) {
    return "OpenRouter free-model daily quota is exhausted. OGFX will retry later or use the next configured provider.";
  }
  if (/429|rate.?limit|temporarily|quota/i.test(message)) {
    return "AI provider is rate-limited right now. OGFX will retry later or use the next configured provider.";
  }
  if (/401|403|unauthorized|forbidden|api key/i.test(message)) {
    return "AI provider rejected the server API key. Check the deployment environment variable.";
  }
  return message.length > 260 ? `${message.slice(0, 257)}...` : message;
}

function parseJson(text: string) {
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
    throw new Error("AI provider returned non-JSON output");
  }
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function side(value: unknown): StructuredSmcAnalysis["bias"] {
  return value === "BUY" || value === "SELL" || value === "WAIT" ? value : "WAIT";
}

export function normalizeSmcAnalysis(value: any, provider: StructuredSmcAnalysis["provider"], model: string): StructuredSmcAnalysis {
  const bias = side(value?.bias ?? value?.decision ?? value?.signal);
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
        { label: "TP/SL defined", status: numberOrNull(stopLoss) && numberOrNull(takeProfit) ? "pass" : "pending" },
        { label: "SMC evidence reviewed", status: "pass" },
      ];

  const confidence = Math.max(0, Math.min(100, Math.round(Number(value?.confidence ?? (bias === "WAIT" ? 45 : 70)))));
  const reasoning = String(value?.reasoning || value?.summary || value?.reason || "No complete setup explanation returned.").slice(0, 2000);
  const strategyAlignment = String(value?.strategy_alignment || value?.strategyAlignment || "Compared against OGFX SMC rules.").slice(0, 1200);

  return {
    bias,
    confidence,
    entry: numberOrNull(value?.entry),
    stop_loss: numberOrNull(stopLoss),
    take_profit: numberOrNull(takeProfit),
    rr_ratio: numberOrNull(rr),
    setup_type: String(value?.setup_type || value?.setupType || (bias === "WAIT" ? "WAIT" : "SMC confluence")).slice(0, 180),
    reasoning,
    strategy_alignment: strategyAlignment,
    checklist,
    gemma_analysis: String(value?.gemma_analysis || value?.gemmaAnalysis || reasoning).slice(0, 4000),
    provider,
    model,
  };
}

function imageContent(imageDataUrl?: string) {
  if (!imageDataUrl) return [];
  return [{
    type: "image_url",
    image_url: { url: imageDataUrl },
  }];
}

function ollamaImages(imageDataUrl?: string) {
  if (!imageDataUrl) return [];
  return [imageDataUrl.replace(/^data:[^;]+;base64,/, "")];
}

function geminiImageParts(imageDataUrl?: string) {
  if (!imageDataUrl) return [];
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  return [{
    inline_data: {
      mime_type: match?.[1] || "image/png",
      data: match?.[2] || imageDataUrl,
    },
  }];
}

async function callOpenRouter(systemPrompt: string, userMessage: string, imageDataUrl?: string) {
  const model = openRouterModel();
  const content = imageDataUrl
    ? [{ type: "text", text: userMessage }, ...imageContent(imageDataUrl)]
    : userMessage;
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://ogfx-frontend.vercel.app",
      "X-Title": "OGFX Elite SMC Trading Engine",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      temperature: 0.1,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    }),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenRouter returned ${response.status}: ${raw.slice(0, 500)}`);
  const payload = JSON.parse(raw || "{}");
  const contentValue = payload?.choices?.[0]?.message?.content;
  const text = Array.isArray(contentValue)
    ? contentValue.map((part: any) => part?.text || "").join("")
    : String(contentValue || "{}");
  return { value: parseJson(text), provider: "openrouter" as const, model };
}

async function callOllama(systemPrompt: string, userMessage: string, imageDataUrl?: string) {
  const model = ollamaModel(Boolean(imageDataUrl));
  const response = await fetch(OLLAMA_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ollamaKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: `${systemPrompt}\n\n${userMessage}`,
        ...(imageDataUrl ? { images: ollamaImages(imageDataUrl) } : {}),
      }],
      stream: false,
      format: "json",
      options: { temperature: 0.1, num_predict: 1200 },
    }),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${raw.slice(0, 500)}`);
  const payload = JSON.parse(raw || "{}");
  return { value: parseJson(payload?.message?.content ?? payload?.response ?? "{}"), provider: "ollama" as const, model };
}

async function callGemini(systemPrompt: string, userMessage: string, imageDataUrl?: string) {
  const model = geminiModel(Boolean(imageDataUrl));
  const response = await fetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": geminiKey(),
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userMessage}` }, ...geminiImageParts(imageDataUrl)] }],
      generationConfig: { temperature: 0.15, responseMimeType: "application/json" },
    }),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Gemini returned ${response.status}: ${raw.slice(0, 500)}`);
  const payload = JSON.parse(raw || "{}");
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join("") ?? "{}";
  return { value: parseJson(text), provider: "gemini" as const, model };
}

async function callProvider(systemPrompt: string, userMessage: string, imageDataUrl?: string, textOnly = false) {
  const errors: string[] = [];

  if (openRouterKey()) {
    try {
      return await callOpenRouter(systemPrompt, userMessage, imageDataUrl);
    } catch (error) {
      errors.push(friendlyAiError(error));
    }
  }

  if (ollamaKey()) {
    try {
      return await callOllama(systemPrompt, userMessage, imageDataUrl);
    } catch (error) {
      errors.push(friendlyAiError(error));
    }
  }

  if (geminiKey()) {
    try {
      return await callGemini(systemPrompt, userMessage, imageDataUrl);
    } catch (error) {
      errors.push(friendlyAiError(error));
    }
  }

  throw new Error(errors.filter(Boolean).join(" | ") || `${textOnly ? "Text" : "AI"} provider key is not configured`);
}

export async function callGemmaAnalysis(params: {
  systemPrompt: string;
  userMessage: string;
  imageDataUrl?: string;
}) {
  const result = await callProvider(params.systemPrompt, params.userMessage, params.imageDataUrl);
  return normalizeSmcAnalysis(result.value, result.provider, result.model);
}

export async function callGemmaText(systemPrompt: string, userMessage: string) {
  const errors: string[] = [];

  if (openRouterKey()) {
    const model = openRouterModel();
    try {
      const response = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://ogfx-frontend.vercel.app",
          "X-Title": "OGFX Elite SMC Trading Coach",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature: 0.35,
          max_tokens: 1200,
        }),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`OpenRouter returned ${response.status}: ${raw.slice(0, 500)}`);
      const payload = JSON.parse(raw || "{}");
      return { content: String(payload?.choices?.[0]?.message?.content || ""), provider: "openrouter" as const, model };
    } catch (error) {
      errors.push(friendlyAiError(error));
    }
  }

  if (ollamaKey()) {
    const model = ollamaModel(false);
    try {
      const response = await fetch(OLLAMA_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${ollamaKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: `${systemPrompt}\n\n${userMessage}` }],
          stream: false,
          options: { temperature: 0.35, num_predict: 1200 },
        }),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${raw.slice(0, 500)}`);
      const payload = JSON.parse(raw || "{}");
      return { content: String(payload?.message?.content || payload?.response || ""), provider: "ollama" as const, model };
    } catch (error) {
      errors.push(friendlyAiError(error));
    }
  }

  if (geminiKey()) {
    const model = geminiModel(false);
    try {
      const response = await fetch(`${GEMINI_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey() },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }],
          generationConfig: { temperature: 0.35 },
        }),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`Gemini returned ${response.status}: ${raw.slice(0, 500)}`);
      const payload = JSON.parse(raw || "{}");
      const content = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join("") ?? "";
      return { content, provider: "gemini" as const, model };
    } catch (error) {
      errors.push(friendlyAiError(error));
    }
  }

  throw new Error(errors.filter(Boolean).join(" | ") || "AI provider key is not configured");
}
