import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { SignalEngine } from "../../../backend-js/src/engine/signalEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");
const envPath = path.join(pluginRoot, ".env");

loadEnvFile(envPath);

const APP_NAME = "ogfx-market-telegram";
const APP_VERSION = "0.1.0";
const DEFAULT_MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 70);
const DEFAULT_TIMEFRAME = "15m";
const DEFAULT_LIMIT = 200;

let signalEngineInstance = null;
let inputBuffer = Buffer.alloc(0);

const tools = [
  {
    name: "get_setup_status",
    description: "Report whether Telegram and market-data settings are configured for this MCP.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "analyze_symbol",
    description: "Analyze a single symbol with the OGFX engine and optionally send an actionable setup to Telegram.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["symbol"],
      properties: {
        symbol: {
          type: "string",
          description: "Market symbol such as BTCUSD, ETHUSD, XAUUSD, EURUSD, GBPUSD, or USDJPY."
        },
        timeframe: {
          type: "string",
          description: "Requested market-data timeframe. Default: 15m."
        },
        min_confidence: {
          type: "number",
          description: "Minimum confidence required before Telegram delivery. Default: MIN_CONFIDENCE or 70."
        },
        send_to_telegram: {
          type: "boolean",
          description: "When true, send actionable BUY/SELL output to Telegram."
        },
        allow_mock_data: {
          type: "boolean",
          description: "Allow analysis to proceed on mock data. Defaults to false."
        }
      }
    }
  },
  {
    name: "analyze_watchlist",
    description: "Analyze multiple symbols and optionally broadcast each actionable setup to Telegram.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["symbols"],
      properties: {
        symbols: {
          type: "array",
          minItems: 1,
          items: {
            type: "string"
          },
          description: "A list of supported symbols."
        },
        timeframe: {
          type: "string",
          description: "Requested market-data timeframe. Default: 15m."
        },
        min_confidence: {
          type: "number",
          description: "Minimum confidence required before Telegram delivery. Default: MIN_CONFIDENCE or 70."
        },
        actionable_only: {
          type: "boolean",
          description: "Return only BUY/SELL outputs."
        },
        send_to_telegram: {
          type: "boolean",
          description: "When true, send each actionable BUY/SELL output to Telegram."
        },
        allow_mock_data: {
          type: "boolean",
          description: "Allow analysis to proceed on mock data. Defaults to false."
        }
      }
    }
  },
  {
    name: "send_telegram_signal",
    description: "Send a custom or structured signal message to the configured Telegram chat.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: {
          type: "string",
          description: "Raw Telegram message body. If omitted, a formatted signal message is generated from the other fields."
        },
        symbol: {
          type: "string"
        },
        signal: {
          type: "string",
          enum: ["BUY", "SELL", "SKIP"]
        },
        confidence: {
          type: "number"
        },
        reason: {
          type: "string"
        },
        entry: {
          type: "number"
        },
        stop_loss: {
          type: "number"
        },
        take_profit: {
          type: "number"
        },
        engine: {
          type: "string"
        },
        grade: {
          type: "string"
        },
        chat_id: {
          type: "string",
          description: "Optional Telegram chat override. Defaults to TELEGRAM_CHAT_ID."
        }
      }
    }
  }
];

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processIncomingMessages();
});

process.stdin.on("end", () => {
  process.exit(0);
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function processIncomingMessages() {
  while (true) {
    const headerEnd = inputBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }

    const headerText = inputBuffer.slice(0, headerEnd).toString("utf8");
    const headers = parseHeaders(headerText);
    const contentLength = Number(headers["content-length"]);

    if (!Number.isFinite(contentLength) || contentLength < 0) {
      writeToStderr("Invalid Content-Length header.");
      inputBuffer = Buffer.alloc(0);
      return;
    }

    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (inputBuffer.length < messageEnd) {
      return;
    }

    const payload = inputBuffer.slice(messageStart, messageEnd).toString("utf8");
    inputBuffer = inputBuffer.slice(messageEnd);

    let message;
    try {
      message = JSON.parse(payload);
    } catch (error) {
      writeToStderr(`Failed to parse JSON payload: ${error.message}`);
      continue;
    }

    handleMessage(message).catch((error) => {
      writeToStderr(`Unhandled MCP error: ${error.stack || error.message}`);
      if (message && Object.prototype.hasOwnProperty.call(message, "id")) {
        sendError(message.id, -32603, error.message || "Internal server error");
      }
    });
  }
}

function parseHeaders(headerText) {
  const headers = {};
  for (const line of headerText.split("\r\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[key] = value;
  }
  return headers;
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }

  const { id, method, params } = message;

  if (!method) {
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion || "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: APP_NAME,
        version: APP_VERSION
      }
    });
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};
    const result = await callTool(toolName, args);
    sendResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    });
    return;
  }

  if (Object.prototype.hasOwnProperty.call(message, "id")) {
    sendError(id, -32601, `Method not found: ${method}`);
  }
}

function sendResult(id, result) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    result
  });
}

function sendError(id, code, message) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  });
}

function sendMessage(payload) {
  const json = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

function writeToStderr(message) {
  process.stderr.write(`${message}\n`);
}

async function callTool(name, args) {
  switch (name) {
    case "get_setup_status":
      return getSetupStatus();
    case "analyze_symbol":
      return analyzeSymbolTool(args);
    case "analyze_watchlist":
      return analyzeWatchlistTool(args);
    case "send_telegram_signal":
      return sendTelegramSignalTool(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function getSetupStatus() {
  return {
    plugin: APP_NAME,
    telegram: {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      has_bot_token: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      has_chat_id: Boolean(process.env.TELEGRAM_CHAT_ID)
    },
    providers: {
      crypto: {
        ready: true,
        source: "Binance public candles"
      },
      forex_and_metals: {
        ready: Boolean(process.env.TWELVEDATA_API_KEY),
        source: "TwelveData",
        requires_api_key: true
      }
    },
    defaults: {
      min_confidence: DEFAULT_MIN_CONFIDENCE,
      timeframe: DEFAULT_TIMEFRAME
    }
  };
}

async function analyzeSymbolTool(args) {
  const symbol = normalizeSymbol(args.symbol);
  const timeframe = args.timeframe || DEFAULT_TIMEFRAME;
  const minConfidence = Number(args.min_confidence || DEFAULT_MIN_CONFIDENCE);
  const allowMockData = Boolean(args.allow_mock_data);
  const sendToTelegram = Boolean(args.send_to_telegram);

  if (!symbol) {
    throw new Error("symbol is required");
  }

  const engine = getSignalEngine();
  const marketData = await engine.marketData.fetchData(symbol, {
    timeframe,
    limit: DEFAULT_LIMIT
  });

  if (marketData.provider === "mock" && !allowMockData) {
    throw new Error(
      `Real market data is unavailable for ${symbol}. Add TWELVEDATA_API_KEY in plugins/ogfx-market-telegram/.env or set allow_mock_data=true for testing only.`
    );
  }

  const analysis = await engine.analyzeSymbol(symbol);
  const normalized = normalizeAnalysisResult(symbol, analysis, marketData);

  if (sendToTelegram && normalized.actionable && normalized.confidence >= minConfidence) {
    normalized.telegram = await sendSignalToTelegram(normalized, {});
  } else if (sendToTelegram) {
    normalized.telegram = {
      sent: false,
      reason: "Signal was not actionable or did not meet the confidence threshold."
    };
  }

  return normalized;
}

async function analyzeWatchlistTool(args) {
  const symbols = Array.isArray(args.symbols) ? args.symbols.map(normalizeSymbol).filter(Boolean) : [];
  const timeframe = args.timeframe || DEFAULT_TIMEFRAME;
  const minConfidence = Number(args.min_confidence || DEFAULT_MIN_CONFIDENCE);
  const actionableOnly = Boolean(args.actionable_only);
  const sendToTelegram = Boolean(args.send_to_telegram);
  const allowMockData = Boolean(args.allow_mock_data);

  if (symbols.length === 0) {
    throw new Error("symbols must contain at least one symbol");
  }

  const results = [];
  for (const symbol of symbols) {
    try {
      const result = await analyzeSymbolTool({
        symbol,
        timeframe,
        min_confidence: minConfidence,
        send_to_telegram: sendToTelegram,
        allow_mock_data: allowMockData
      });
      results.push(result);
    } catch (error) {
      results.push({
        symbol,
        actionable: false,
        signal: "ERROR",
        error: error.message
      });
    }
  }

  const filtered = actionableOnly
    ? results.filter((result) => result.actionable)
    : results;

  return {
    count: filtered.length,
    analyzed: results.length,
    results: filtered
  };
}

async function sendTelegramSignalTool(args) {
  if (args.message) {
    return sendTelegramMessage(args.message, args.chat_id);
  }

  const signal = {
    symbol: normalizeSymbol(args.symbol),
    signal: String(args.signal || "SKIP").toUpperCase(),
    confidence: Number(args.confidence || 0),
    reason: args.reason || "Manual Telegram signal",
    entry: toOptionalNumber(args.entry),
    stop_loss: toOptionalNumber(args.stop_loss),
    take_profit: toOptionalNumber(args.take_profit),
    engine: args.engine || "manual",
    grade: args.grade || null
  };

  return sendSignalToTelegram(signal, { chatId: args.chat_id });
}

function getSignalEngine() {
  if (!signalEngineInstance) {
    signalEngineInstance = new SignalEngine();
  }
  return signalEngineInstance;
}

function normalizeSymbol(symbol) {
  if (!symbol || typeof symbol !== "string") {
    return "";
  }

  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeAnalysisResult(symbol, analysis, marketData) {
  if (!analysis?.signal) {
    return {
      symbol,
      provider: marketData.provider || inferProvider(symbol),
      engine: analysis?.engine || "none",
      actionable: false,
      signal: "SKIP",
      reason: analysis?.reason || analysis?.error || "No valid setup found.",
      price: marketData.close,
      timeframe: marketData.timeframe || DEFAULT_TIMEFRAME
    };
  }

  const rawSignal = analysis.signal;
  const signal = String(rawSignal.type || rawSignal.signal || "SKIP").toUpperCase();
  const actionable = signal === "BUY" || signal === "SELL";

  return {
    symbol,
    provider: marketData.provider || inferProvider(symbol),
    engine: analysis.engine || "ogfx",
    grade: analysis.grade || rawSignal.grade || null,
    actionable,
    signal,
    confidence: Number(rawSignal.confidence || 0),
    reason: rawSignal.reason || "Technical setup",
    entry: toOptionalNumber(rawSignal.entry ?? rawSignal.entry_price ?? marketData.close),
    stop_loss: toOptionalNumber(rawSignal.stopLoss ?? rawSignal.stop_loss),
    take_profit: toOptionalNumber(rawSignal.takeProfit ?? rawSignal.take_profit),
    risk_reward: computeRiskReward(rawSignal),
    price: marketData.close,
    timeframe: marketData.timeframe || DEFAULT_TIMEFRAME,
    timestamp: rawSignal.timestamp || new Date().toISOString()
  };
}

function inferProvider(symbol) {
  return isCryptoSymbol(symbol) ? "binance" : "unknown";
}

function isCryptoSymbol(symbol) {
  return symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL") || symbol.includes("BNB");
}

function computeRiskReward(signal) {
  if (typeof signal.riskReward === "number") {
    return signal.riskReward;
  }

  const entry = Number(signal.entry ?? signal.entry_price);
  const stop = Number(signal.stopLoss ?? signal.stop_loss);
  const take = Number(signal.takeProfit ?? signal.take_profit);

  if (![entry, stop, take].every(Number.isFinite)) {
    return null;
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(take - entry);
  if (risk === 0) {
    return null;
  }

  return Number((reward / risk).toFixed(2));
}

function toOptionalNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildTelegramSignalMessage(signal) {
  const emoji = signal.signal === "BUY" ? "🟢" : signal.signal === "SELL" ? "🔴" : "⚪";
  const lines = [
    `*OGFX Market Signal*`,
    ``,
    `${emoji} *${signal.signal || "SKIP"}* \`${signal.symbol || "N/A"}\``,
    `*Engine:* ${signal.engine || "ogfx"}`,
    signal.grade ? `*Grade:* ${signal.grade}` : null,
    typeof signal.confidence === "number" ? `*Confidence:* ${signal.confidence}%` : null,
    signal.reason ? `*Reason:* ${signal.reason}` : null,
    signal.entry != null ? `*Entry:* \`${formatPrice(signal.entry, signal.symbol)}\`` : null,
    signal.stop_loss != null ? `*Stop Loss:* \`${formatPrice(signal.stop_loss, signal.symbol)}\`` : null,
    signal.take_profit != null ? `*Take Profit:* \`${formatPrice(signal.take_profit, signal.symbol)}\`` : null,
    signal.risk_reward != null ? `*Risk/Reward:* ${signal.risk_reward}:1` : null,
    ``,
    `_Research signal only. Not financial advice._`
  ];

  return lines.filter(Boolean).join("\n");
}

function formatPrice(value, symbol) {
  const digits = String(symbol || "").includes("JPY") ? 3 : 5;
  return Number(value).toFixed(digits);
}

async function sendSignalToTelegram(signal, options = {}) {
  const message = buildTelegramSignalMessage(signal);
  return sendTelegramMessage(message, options.chatId);
}

async function sendTelegramMessage(message, chatIdOverride) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = chatIdOverride || process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {
      sent: false,
      reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing."
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    return {
      sent: false,
      reason: payload.description || `Telegram HTTP ${response.status}`
    };
  }

  return {
    sent: true,
    chat_id: String(chatId),
    message_id: payload.result?.message_id || null
  };
}
