/**
 * Signal Engine - Combines SMC (Smart Money Concepts) and Rule-Based engines
 * Manages the complete signal generation pipeline with institutional-grade SMC logic
 */

import { RuleEngine } from "./ruleEngine.js";
import { ContextEngine } from "./contextEngine.js";
import { MarketDataService } from "../services/marketData.js";
import { logger } from "../services/logger.js";
import fs from "node:fs";

function loadDefaultStrategy() {
  const candidates = [
    // In Railway/Nixpacks the app root is the backend-js folder
    new URL("../../strategies/default.json", import.meta.url),
    // In local mono-repo dev, strategies may live at repo root
    new URL("../../../strategies/default.json", import.meta.url),
  ];

  for (const url of candidates) {
    try {
      const raw = fs.readFileSync(url, "utf-8");
      return JSON.parse(raw);
    } catch {
      // try next candidate
    }
  }

  // Last-resort fallback: keep engine alive even if file missing.
  return {
    name: "OGFX Default Strategy (Fallback)",
    version: "1.0.0",
    rules: { BUY: {}, SELL: {} },
    context: { minConfidence: 60 },
    riskManagement: { slMultiplier: 2, tpMultiplier: 3, minRiskReward: 1.5, maxDailySignals: 10 },
  };
}

const defaultStrategy = loadDefaultStrategy();

// Import SMC engines
import { SMCSignalEngine, defaultSMCConfig, smcStrategyTemplate } from "./smc/index.js";

// Import ELITE engines
import { EliteSignalEngine, eliteConfig, eliteStrategyTemplate } from "./elite/index.js";

export class SignalEngine {
  constructor() {
    // Legacy rule-based engines (kept for compatibility)
    this.ruleEngine = new RuleEngine(defaultStrategy);
    this.contextEngine = new ContextEngine(defaultStrategy.context);
    
    // SMC Engine (secondary)
    this.smcEngine = new SMCSignalEngine(defaultSMCConfig);
    
    // ELITE Engine (primary - multi-layer filter)
    this.eliteEngine = new EliteSignalEngine(eliteConfig);
    
    this.marketData = new MarketDataService();
    this.running = false;
    this.intervalId = null;
    this.symbols = [
      "XAUUSD",
      "BTCUSD",
      "ETHUSD",
      "GBPUSD",
      "EURUSD",
      "USDJPY",
      "USOIL",
      "NAS100",
      "SPX500",
    ];
    this.onSignalGenerated = null; // Callback for new signals
    this.lastAnalysis = new Map();
    
    // SMC Engine signal callback
    this.smcEngine.onSignalGenerated = (signal) => {
      this.handleSMCSignal(signal);
    };
    
    // ELITE Engine signal callback
    this.eliteEngine.onSignalGenerated = (signal) => {
      this.handleEliteSignal(signal);
    };
  }

  async start() {
    if (this.running) return;

    this.running = true;
    logger.info("Signal engine starting...");
    logger.info("Mode: Smart Money Concepts (SMC) with Rule-Based fallback");

    // Start SMC Engine
    await this.smcEngine.start();

    // Initial analysis using SMC
    await this.analyzeAll();

    // Set up interval for continuous Render/VPS analysis.
    const intervalMs = Math.max(5, Number(process.env.SIGNAL_INTERVAL_SECONDS || 60)) * 1000;
    this.intervalId = setInterval(() => {
      this.analyzeAll();
    }, intervalMs);

    logger.info(`Signal engine running (${intervalMs / 1000}s interval)`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // Stop SMC Engine
    this.smcEngine.stop();
    
    this.running = false;
    logger.info("Signal engine stopped");
  }

  isRunning() {
    return this.running;
  }

  getStrategyConfig() {
    return {
      elite: eliteStrategyTemplate,
      smc: smcStrategyTemplate,
      fallback: defaultStrategy,
    };
  }

  getSMCConfig() {
    return defaultSMCConfig;
  }

  getEliteConfig() {
    return eliteConfig;
  }

  async analyzeAll() {
    const results = [];

    for (const symbol of this.symbols) {
      try {
        const result = await this.analyzeSymbol(symbol);
        if (result.signal) {
          results.push(result);
        }
      } catch (error) {
        logger.error(`Error analyzing ${symbol}:`, error);
      }
    }

    return results;
  }

  async analyzeSymbol(symbol, opts = {}) {
    try {
      // Fetch market data
      const data = await this.marketData.fetchData(symbol, opts);

      // Layer 1: Try ELITE engine first (A+ grade only)
      const eliteResult = this.eliteEngine.analyze(symbol, data);
      
      if (eliteResult.valid && eliteResult.signal) {
        // ELITE generated an A+ grade signal
        this.lastAnalysis.set(symbol, {
          signal: eliteResult.signal,
          timestamp: Date.now(),
        });
        
        // Callback triggered by Elite engine
        return {
          symbol,
          signal: eliteResult.signal,
          engine: "ELITE",
          grade: eliteResult.grade,
          layers: eliteResult.layers,
          eliteData: eliteResult.signal.eliteData,
        };
      }

      // Layer 2: Try SMC engine (70%+ confidence)
      const smcSignal = this.smcEngine.analyze(symbol, data);
      
      if (smcSignal) {
        // SMC generated a valid signal
        this.lastAnalysis.set(symbol, {
          signal: smcSignal,
          timestamp: Date.now(),
        });
        
        // Callback will be triggered by SMC engine
        return {
          symbol,
          signal: smcSignal,
          engine: "SMC",
          smcData: smcSignal.smcData,
        };
      }

      // Layer 3: Fallback to rule-based engine (legacy)
      const ruleResult = this.ruleEngine.evaluate(data);

      if (!ruleResult.valid) {
        return {
          symbol,
          signal: null,
          engine: "none",
          reason: "No valid signal - Elite, SMC, and Rule-based all rejected",
          eliteReason: eliteResult.rejectedAt,
        };
      }

      // Run context engine
      const contextResult = this.contextEngine.analyze(data, ruleResult);

      if (!contextResult.valid) {
        return {
          symbol,
          signal: null,
          engine: "none",
          reason: "Context filter rejected",
        };
      }

      // Generate signal using fallback
      const signal = this.generateSignal(
        symbol,
        ruleResult.type,
        data,
        contextResult
      );

      if (this.isDuplicate(symbol, signal)) {
        return {
          symbol,
          signal: null,
          engine: "none",
          reason: "Duplicate signal",
        };
      }

      // Store and notify
      this.lastAnalysis.set(symbol, {
        signal,
        timestamp: Date.now(),
      });

      if (this.onSignalGenerated) {
        this.onSignalGenerated(signal);
      }

      return {
        symbol,
        signal,
        engine: "fallback",
        ruleChecks: ruleResult.checks,
        context: contextResult,
      };
    } catch (error) {
      logger.error(`Analysis failed for ${symbol}:`, error);
      return {
        symbol,
        signal: null,
        error: error.message,
      };
    }
  }

  generateSignal(symbol, type, data, context) {
    const price = data.close;
    const atr = data.indicators?.atr?.[14] || price * 0.001;

    // Calculate SL and TP based on ATR
    const slDistance = atr * 2; // 2x ATR for stop loss
    const tpDistance = atr * 3; // 3x ATR for take profit (1.5:1 RR)

    const entry = price;
    const stopLoss = type === "BUY" ? entry - slDistance : entry + slDistance;
    const takeProfit =
      type === "BUY" ? entry + tpDistance : entry - tpDistance;

    // Build reason string
    const reasons = [];
    if (context.factors.trend?.aligned) {
      reasons.push("Trend aligned");
    }
    if (context.factors.volume?.confirmed) {
      reasons.push("Volume confirmed");
    }
    if (context.factors.session?.optimal) {
      reasons.push("Optimal session");
    }
    if (context.factors.levels?.nearSupport || context.factors.levels?.nearResistance) {
      reasons.push("Near key level");
    }

    return {
      id: `${symbol}-${Date.now()}`,
      pair: symbol,
      type,
      entry: parseFloat(entry.toFixed(symbol.includes("JPY") ? 3 : 5)),
      stopLoss: parseFloat(stopLoss.toFixed(symbol.includes("JPY") ? 3 : 5)),
      takeProfit: parseFloat(takeProfit.toFixed(symbol.includes("JPY") ? 3 : 5)),
      confidence: context.confidence,
      reason: reasons.join(" + ") || "Technical setup",
      timestamp: new Date().toISOString(),
      status: "ACTIVE",
      context: {
        atr,
        session: context.factors.session?.session,
        trendStrength: context.factors.trend?.strength,
      },
    };
  }

  isDuplicate(symbol, newSignal) {
    const last = this.lastAnalysis.get(symbol);
    if (!last) return false;

    // Don't generate new signal if last one is still active
    if (last.signal && last.signal.status === "ACTIVE") {
      return true;
    }

    // Minimum time between signals based on engine quality
    const isElite = newSignal?.eliteData !== undefined;
    const isSMC = newSignal?.smcData !== undefined;
    
    let minInterval;
    if (isElite) {
      minInterval = 15 * 60 * 1000; // 15 min for Elite (A+ grade)
    } else if (isSMC) {
      minInterval = 20 * 60 * 1000; // 20 min for SMC
    } else {
      minInterval = 30 * 60 * 1000; // 30 min for fallback
    }
    
    if (Date.now() - last.timestamp < minInterval) {
      return true;
    }

    return false;
  }

  /**
   * Handle signals from SMC engine
   */
  handleSMCSignal(signal) {
    logger.info(`SMC Signal generated: ${signal.pair} ${signal.type} (${signal.confidence}%)`);
    
    if (this.onSignalGenerated) {
      this.onSignalGenerated(signal);
    }
  }

  /**
   * Handle signals from ELITE engine
   */
  handleEliteSignal(signal) {
    logger.info(`🎯 ELITE Signal generated: ${signal.pair} ${signal.type} [${signal.grade}] (${signal.confidence}%)`);
    
    if (this.onSignalGenerated) {
      this.onSignalGenerated(signal);
    }
  }

  /**
   * Get SMC analysis for a symbol (for diagnostics)
   */
  async getSMCAnalysis(symbol) {
    try {
      const data = await this.marketData.fetchData(symbol);
      
      // Get all SMC components
      const structure = this.smcEngine.structureEngine.analyze(data.candles);
      const liquidity = this.smcEngine.liquidityEngine.analyze(data.candles);
      const sweep = this.smcEngine.sweepDetector.detect(data.candles, liquidity);
      const zones = this.smcEngine.zoneDetector.detect(data.candles);
      
      return {
        symbol,
        timestamp: new Date().toISOString(),
        structure,
        liquidity,
        sweep,
        zones,
        currentPrice: data.close,
      };
    } catch (error) {
      logger.error(`Error getting SMC analysis for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get ELITE analysis for a symbol (for diagnostics)
   */
  async getEliteAnalysis(symbol) {
    try {
      const data = await this.marketData.fetchData(symbol);
      
      // Get all Elite components
      const htfCandles = this.eliteEngine.createHTFCandles(data.candles, 4);
      const bias = this.eliteEngine.htfEngine.analyze(htfCandles);
      const liquidity = this.eliteEngine.liquidityEngine.mapLiquidity(data.candles, bias);
      const zones = this.eliteEngine.zoneDetector.detect(data.candles);
      
      // Get risk stats
      const riskStats = this.eliteEngine.getRiskStats();
      
      return {
        symbol,
        timestamp: new Date().toISOString(),
        bias,
        liquidity,
        zones,
        currentPrice: data.close,
        riskStats,
        canTrade: riskStats.canTrade,
      };
    } catch (error) {
      logger.error(`Error getting Elite analysis for ${symbol}:`, error);
      return null;
    }
  }
}
