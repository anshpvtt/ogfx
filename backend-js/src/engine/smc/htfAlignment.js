/**
 * Higher Time Frame (HTF) Alignment Engine
 * Analyzes higher timeframe bias for directional alignment
 * Only trade in direction of HTF trend
 */

import { logger } from "../../services/logger.js";
import { MarketStructureEngine } from "./marketStructure.js";

export class HTFAlignmentEngine {
  constructor(config = {}) {
    this.config = {
      htfInterval: config.htfInterval || "1h", // Higher timeframe
      ltfInterval: config.ltfInterval || "15m", // Lower timeframe (entry)
      minAlignmentScore: config.minAlignmentScore || 60,
      ...config,
    };

    this.structureEngine = new MarketStructureEngine(config.structure);
  }

  /**
   * Analyze HTF bias
   * @param {Array} htfCandles - Higher timeframe candle data
   * @returns {Object} HTF bias analysis
   */
  analyze(htfCandles) {
    if (!htfCandles || htfCandles.length < 10) {
      return {
        bias: "neutral",
        trend: "unknown",
        alignment: "neutral",
        score: 0,
        direction: null,
      };
    }

    // Get market structure on HTF
    const structure = this.structureEngine.analyze(htfCandles);

    // Get trend direction
    const trend = this.determineTrend(structure, htfCandles);

    // Calculate alignment score
    const score = this.calculateAlignmentScore(structure, htfCandles);

    // Determine bias
    let bias = "neutral";
    let alignment = "neutral";

    if (score >= this.config.minAlignmentScore) {
      if (trend === "bullish") {
        bias = "bullish";
        alignment = "long_only";
      } else if (trend === "bearish") {
        bias = "bearish";
        alignment = "short_only";
      }
    }

    return {
      bias,
      trend,
      alignment,
      score,
      direction: trend,
      structure,
      supportsLong: bias === "bullish" || bias === "neutral",
      supportsShort: bias === "bearish" || bias === "neutral",
      // Key levels from HTF
      keyLevels: this.extractKeyLevels(structure, htfCandles),
      // Trading zones
      tradingZone: this.determineTradingZone(structure, htfCandles),
    };
  }

  /**
   * Determine HTF trend direction
   */
  determineTrend(structure, candles) {
    const currentPrice = candles[candles.length - 1].close;

    // Primary: Use structure trend
    if (structure.trend === "bullish" || structure.trend === "bullish_bias") {
      return "bullish";
    }
    if (structure.trend === "bearish" || structure.trend === "bearish_bias") {
      return "bearish";
    }

    // Secondary: Use EMA alignment if available
    const ema50 = this.calculateEMA(candles, 50);
    const ema200 = this.calculateEMA(candles, 200);

    if (ema50 && ema200) {
      if (currentPrice > ema50 && ema50 > ema200) {
        return "bullish";
      }
      if (currentPrice < ema50 && ema50 < ema200) {
        return "bearish";
      }
    }

    // Tertiary: Use price position in recent range
    const recent = candles.slice(-20);
    const rangeHigh = Math.max(...recent.map((c) => c.high));
    const rangeLow = Math.min(...recent.map((c) => c.low));
    const midPoint = (rangeHigh + rangeLow) / 2;

    if (currentPrice > midPoint * 1.02) return "bullish";
    if (currentPrice < midPoint * 0.98) return "bearish";

    return "ranging";
  }

  /**
   * Calculate alignment strength score (0-100)
   */
  calculateAlignmentScore(structure, candles) {
    let score = 0;

    // Structure clarity (30 points)
    if (structure.trend === "bullish" || structure.trend === "bearish") {
      score += 30;
    } else if (structure.trend === "bullish_bias" || structure.trend === "bearish_bias") {
      score += 20;
    }

    // Pattern strength (20 points)
    if (structure.patterns) {
      const { higherHigh, higherLow, lowerHigh, lowerLow } = structure.patterns;

      if ((higherHigh && higherLow) || (lowerHigh && lowerLow)) {
        score += 20;
      } else if (higherHigh || higherLow || lowerHigh || lowerLow) {
        score += 10;
      }
    }

    // Break of structure recency (20 points)
    if (structure.breaks && structure.breaks.length > 0) {
      const recentBreak = structure.breaks[structure.breaks.length - 1];
      const age = Date.now() - new Date(recentBreak.timestamp).getTime();
      if (age < 60 * 60 * 1000) { // Within 1 hour
        score += 20;
      } else if (age < 4 * 60 * 60 * 1000) { // Within 4 hours
        score += 10;
      }
    }

    // Momentum (20 points)
    const momentum = this.calculateMomentum(candles, 10);
    if (Math.abs(momentum) > 2) score += 20;
    else if (Math.abs(momentum) > 1) score += 10;

    // Volatility (10 points)
    const volatility = this.calculateVolatility(candles);
    if (volatility > 0.5 && volatility < 3.0) score += 10;

    return Math.min(100, score);
  }

  /**
   * Extract key HTF levels
   */
  extractKeyLevels(structure, candles) {
    const levels = [];

    // Add swing highs and lows
    if (structure.swings) {
      for (const swing of structure.swings.slice(-6)) {
        levels.push({
          price: swing.price,
          type: swing.type === "high" ? "resistance" : "support",
          source: `htf_${swing.type}`,
        });
      }
    }

    // Add range high and low
    const recent = candles.slice(-20);
    const high = Math.max(...recent.map((c) => c.high));
    const low = Math.min(...recent.map((c) => c.low));

    levels.push(
      { price: high, type: "resistance", source: "htf_range_high" },
      { price: low, type: "support", source: "htf_range_low" }
    );

    return levels.sort((a, b) => b.price - a.price);
  }

  /**
   * Determine optimal trading zone
   */
  determineTradingZone(structure, candles) {
    const currentPrice = candles[candles.length - 1].close;
    const levels = this.extractKeyLevels(structure, candles);

    if (levels.length < 2) return null;

    // Find nearest support and resistance
    const supports = levels.filter((l) => l.type === "support" && l.price < currentPrice);
    const resistances = levels.filter((l) => l.type === "resistance" && l.price > currentPrice);

    const nearestSupport = supports.length > 0 ? Math.max(...supports.map((s) => s.price)) : null;
    const nearestResistance = resistances.length > 0 ? Math.min(...resistances.map((r) => r.price)) : null;

    return {
      currentPrice,
      nearestSupport,
      nearestResistance,
      range: nearestResistance && nearestSupport
        ? nearestResistance - nearestSupport
        : null,
      position: this.calculateZonePosition(currentPrice, nearestSupport, nearestResistance),
    };
  }

  /**
   * Calculate position within zone (0-100%)
   */
  calculateZonePosition(price, support, resistance) {
    if (!support || !resistance) return null;
    return ((price - support) / (resistance - support)) * 100;
  }

  /**
   * Check if LTF setup aligns with HTF
   */
  isAligned(htfBias, ltfDirection) {
    if (htfBias.bias === "neutral") return true; // No strong bias
    if (htfBias.bias === "bullish" && ltfDirection === "BUY") return true;
    if (htfBias.bias === "bearish" && ltfDirection === "SELL") return true;
    return false;
  }

  /**
   * Get alignment bonus for confidence
   */
  getAlignmentBonus(htfBias, ltfDirection) {
    if (this.isAligned(htfBias, ltfDirection)) {
      // Full alignment bonus
      return htfBias.score * 0.3; // Up to 30 points
    }
    // Penalty for trading against HTF
    return -20;
  }

  /**
   * Calculate momentum
   */
  calculateMomentum(candles, period) {
    if (candles.length < period) return 0;

    const current = candles[candles.length - 1].close;
    const past = candles[candles.length - period].close;

    return ((current - past) / past) * 100;
  }

  /**
   * Calculate volatility as percentage
   */
  calculateVolatility(candles) {
    if (candles.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < candles.length; i++) {
      returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev * 100; // As percentage
  }

  /**
   * Calculate EMA
   */
  calculateEMA(candles, period) {
    if (candles.length < period) return null;

    const closes = candles.map((c) => c.close);
    const multiplier = 2 / (period + 1);

    let ema = closes.slice(0, period).reduce((a, b) => a + b) / period;

    for (let i = period; i < closes.length; i++) {
      ema = (closes[i] - ema) * multiplier + ema;
    }

    return ema;
  }
}
