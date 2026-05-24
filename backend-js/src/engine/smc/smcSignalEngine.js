/**
 * Smart Money Concepts (SMC) Signal Engine
 * Complete trading system combining all SMC components
 * Generates high-quality signals based on liquidity sweeps and institutional order flow
 */

import { MarketStructureEngine } from "./marketStructure.js";
import { LiquidityEngine } from "./liquidityEngine.js";
import { SweepDetector } from "./sweepDetector.js";
import { ConfirmationEngine } from "./confirmationEngine.js";
import { HTFAlignmentEngine } from "./htfAlignment.js";
import { ZoneDetector } from "./zoneDetector.js";
import { ContextFilter } from "./contextFilter.js";
import { logger } from "../../services/logger.js";

export class SMCSignalEngine {
  constructor(config = {}) {
    this.config = {
      minConfidence: config.minConfidence || 70, // Higher threshold for SMC
      requireSweep: config.requireSweep ?? true,
      requireConfirmation: config.requireConfirmation ?? true,
      requireHTFAlignment: config.requireHTFAlignment ?? true,
      targetRR: config.targetRR || 2.0, // Risk:Reward ratio
      ...config,
    };

    // Initialize all engines
    this.structureEngine = new MarketStructureEngine(config.structure);
    this.liquidityEngine = new LiquidityEngine(config.liquidity);
    this.sweepDetector = new SweepDetector(config.sweep);
    this.confirmationEngine = new ConfirmationEngine(config.confirmation);
    this.htfEngine = new HTFAlignmentEngine(config.htf);
    this.zoneDetector = new ZoneDetector(config.zones);
    this.contextFilter = new ContextFilter(config.context);

    // State
    this.running = false;
    this.intervalId = null;
    this.symbols = config.symbols || ["XAUUSD", "EURUSD", "GBPUSD", "BTCUSD", "USDJPY"];
    this.onSignalGenerated = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    logger.info("SMC Signal Engine started");
    logger.info(`Symbols: ${this.symbols.join(", ")}`);
    logger.info(`Min confidence: ${this.config.minConfidence}%`);

    // Clear old cooldowns periodically
    this.intervalId = setInterval(() => {
      this.contextFilter.clearOldCooldowns();
    }, 60000); // Every minute
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info("SMC Signal Engine stopped");
  }

  /**
   * Analyze symbol for SMC signals
   * @param {string} symbol - Trading symbol
   * @param {Object} data - Market data with candles
   * @returns {Object} Signal or null
   */
  analyze(symbol, data) {
    try {
      const candles = data.candles || data;
      const currentPrice = candles[candles.length - 1].close;

      // Step 1: Market Structure
      const structure = this.structureEngine.analyze(candles);

      // Step 2: Liquidity Detection
      const liquidity = this.liquidityEngine.analyze(candles);

      // Step 3: Sweep Detection
      const sweep = this.sweepDetector.detect(candles, liquidity);

      // Step 4: HTF Analysis (using same candles as proxy for HTF)
      // In production, fetch actual HTF candles
      const htfData = this.createHTFCandles(candles, 4); // 4x aggregation
      const htf = this.htfEngine.analyze(htfData);

      // Step 5: Supply/Demand Zones
      const zones = this.zoneDetector.detect(candles);

      // Step 6: Confirmation (if we have a sweep)
      const confirmation = this.confirmationEngine.analyze(candles, structure, sweep);

      // Step 7: Context Filter
      const contextData = {
        session: this.getSession(),
        volatility: data.indicators?.atr,
        spread: data.spread || { percent: 0.01 },
        htf,
      };
      const context = this.contextFilter.validate(contextData, symbol);

      // Generate signal if all conditions met
      const signal = this.generateSignal({
        symbol,
        currentPrice,
        structure,
        liquidity,
        sweep,
        confirmation,
        htf,
        zones,
        context,
        candles,
      });

      if (signal) {
        // Record for cooldown
        this.contextFilter.recordSignal(symbol);

        // Notify callback
        if (this.onSignalGenerated) {
          this.onSignalGenerated(signal);
        }
      }

      return signal;
    } catch (error) {
      logger.error(`Error analyzing ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Generate trading signal from all SMC components
   */
  generateSignal(analysis) {
    const {
      symbol,
      currentPrice,
      structure,
      liquidity,
      sweep,
      confirmation,
      htf,
      zones,
      context,
      candles,
    } = analysis;

    // Check context filter first
    if (!context.valid) {
      return null;
    }

    // Check for sweep (required for SMC)
    if (this.config.requireSweep && (!sweep || !sweep.lastSweep)) {
      return null;
    }

    // Determine direction based on sweep
    let direction = null;
    let sweepType = null;

    if (sweep.sweepBelow) {
      direction = "BUY";
      sweepType = "sell_side_sweep";
    } else if (sweep.sweepAbove) {
      direction = "SELL";
      sweepType = "buy_side_sweep";
    }

    if (!direction) return null;

    // Check HTF alignment
    if (this.config.requireHTFAlignment && !this.htfEngine.isAligned(htf, direction)) {
      return null;
    }

    // Check for confirmation
    if (this.config.requireConfirmation) {
      const hasConfirmation = direction === "BUY"
        ? confirmation.bullish
        : confirmation.bearish;

      if (!hasConfirmation) return null;
    }

    // Calculate confidence
    const confidence = this.calculateConfidence(analysis, direction);

    if (confidence < this.config.minConfidence) {
      return null;
    }

    // Calculate entry, SL, TP
    const levels = this.calculateLevels(analysis, direction, currentPrice);

    if (!levels) return null;

    // Build reason string
    const reasons = this.buildReasons(analysis, direction, sweepType);

    return {
      id: `SMC-${symbol}-${Date.now()}`,
      pair: symbol,
      type: direction,
      entry: levels.entry,
      stopLoss: levels.sl,
      takeProfit: levels.tp,
      confidence,
      reason: reasons,
      timestamp: new Date().toISOString(),
      status: "ACTIVE",
      smcData: {
        sweep: sweep.lastSweep,
        confirmation: confirmation.strongestSignal,
        htfBias: htf.bias,
        zone: direction === "BUY" ? zones.nearestDemand : zones.nearestSupply,
        structure: structure.trend,
      },
      riskReward: levels.rr,
      context: {
        session: contextData.session,
        htfScore: htf.score,
        contextScore: context.score,
      },
    };
  }

  /**
   * Calculate entry, SL, and TP levels
   */
  calculateLevels(analysis, direction, currentPrice) {
    const { sweep, zones, liquidity, htf } = analysis;

    let entry = currentPrice;
    let sl, tp;

    // Use sweep level for SL
    if (direction === "BUY") {
      // SL below the sweep low
      sl = sweep.details?.sellSide?.wickLow || zones.nearestDemand?.low;
      if (!sl) return null;

      // TP at next liquidity pool or HTF level
      const target = liquidity.distanceToLiquidity(currentPrice, liquidity, "up");
      if (target) {
        tp = target.target;
      } else if (htf.tradingZone?.nearestResistance) {
        tp = htf.tradingZone.nearestResistance;
      } else {
        // Calculate based on RR ratio
        const risk = entry - sl;
        tp = entry + risk * this.config.targetRR;
      }
    } else {
      // SELL
      // SL above the sweep high
      sl = sweep.details?.buySide?.wickHigh || zones.nearestSupply?.high;
      if (!sl) return null;

      // TP at next liquidity pool
      const target = liquidity.distanceToLiquidity(currentPrice, liquidity, "down");
      if (target) {
        tp = target.target;
      } else if (htf.tradingZone?.nearestSupport) {
        tp = htf.tradingZone.nearestSupport;
      } else {
        const risk = sl - entry;
        tp = entry - risk * this.config.targetRR;
      }
    }

    // Round to proper decimals
    const decimals = this.getDecimals(analysis.symbol);
    entry = parseFloat(entry.toFixed(decimals));
    sl = parseFloat(sl.toFixed(decimals));
    tp = parseFloat(tp.toFixed(decimals));

    // Calculate R:R
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    const rr = reward / risk;

    // Reject if RR too low
    if (rr < 1.5) {
      return null;
    }

    return { entry, sl, tp, rr };
  }

  /**
   * Calculate overall confidence score
   */
  calculateConfidence(analysis, direction) {
    let confidence = 0;

    const { sweep, confirmation, htf, zones, context, structure } = analysis;

    // Sweep quality (30 points)
    const sweepStrength = sweep.lastSweep?.strength || 0;
    confidence += sweepStrength * 0.3;

    // Confirmation (20 points)
    confidence += confirmation.confidence * 0.2;

    // HTF alignment (20 points)
    const htfBonus = this.htfEngine.getAlignmentBonus(htf, direction);
    confidence += Math.max(0, htfBonus);

    // Zone quality (15 points)
    const relevantZone = direction === "BUY" ? zones.nearestDemand : zones.nearestSupply;
    if (relevantZone) {
      confidence += relevantZone.quality * 0.15;
    }

    // Context filter (10 points)
    confidence += context.score * 0.1;

    // Structure alignment (5 points)
    const structureAligned =
      (direction === "BUY" && (structure.trend === "bullish" || structure.trend === "bullish_bias")) ||
      (direction === "SELL" && (structure.trend === "bearish" || structure.trend === "bearish_bias"));
    if (structureAligned) confidence += 5;

    return Math.round(confidence);
  }

  /**
   * Build human-readable reason string
   */
  buildReasons(analysis, direction, sweepType) {
    const reasons = [];
    const { sweep, confirmation, htf, zones, structure } = analysis;

    // Sweep reason
    if (sweepType === "sell_side_sweep") {
      reasons.push("Sell-side liquidity sweep");
    } else if (sweepType === "buy_side_sweep") {
      reasons.push("Buy-side liquidity sweep");
    }

    // Confirmation reason
    if (confirmation.strongestSignal) {
      const confType = confirmation.strongestSignal.type.replace(/_/g, " ");
      reasons.push(confType);
    }

    // HTF alignment
    if (htf.bias !== "neutral") {
      reasons.push(`HTF ${htf.bias} alignment (${htf.score}%)`);
    }

    // Zone
    const relevantZone = direction === "BUY" ? zones.nearestDemand : zones.nearestSupply;
    if (relevantZone) {
      reasons.push(`${relevantZone.type} zone (Q:${relevantZone.quality})`);
    }

    // Structure
    if (structure.trend !== "ranging") {
      reasons.push(`Structure: ${structure.trend}`);
    }

    return reasons.join(" + ");
  }

  /**
   * Create aggregated HTF candles from LTF data
   */
  createHTFCandles(candles, factor) {
    const htf = [];

    for (let i = 0; i < candles.length; i += factor) {
      const chunk = candles.slice(i, i + factor);
      if (chunk.length === 0) continue;

      htf.push({
        open: chunk[0].open,
        high: Math.max(...chunk.map((c) => c.high)),
        low: Math.min(...chunk.map((c) => c.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((sum, c) => sum + (c.volume || 0), 0),
        timestamp: chunk[0].timestamp,
      });
    }

    return htf;
  }

  /**
   * Get current trading session
   */
  getSession() {
    const now = new Date();
    const utcHour = now.getUTCHours();

    const londonOpen = 8;
    const londonClose = 17;
    const nyOpen = 13;
    const nyClose = 22;

    const inLondon = utcHour >= londonOpen && utcHour < londonClose;
    const inNY = utcHour >= nyOpen && utcHour < nyClose;

    return {
      favorable: inLondon || inNY,
      optimal: inLondon && inNY, // Overlap
      session: inLondon && inNY ? "London-NY" : inLondon ? "London" : inNY ? "New York" : "Off-hours",
      hour: utcHour,
    };
  }

  /**
   * Get decimal places for symbol
   */
  getDecimals(symbol) {
    if (symbol.includes("JPY")) return 3;
    if (symbol.includes("XAU") || symbol.includes("GOLD")) return 2;
    if (symbol.includes("BTC") || symbol.includes("ETH")) return 2;
    return 5;
  }
}
