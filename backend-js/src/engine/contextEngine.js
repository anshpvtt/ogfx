/**
 * Context Engine - Enhances signals with market context
 * Adjusts confidence and filters based on market conditions
 */

import { logger } from "../services/logger.js";

export class ContextEngine {
  constructor(config) {
    this.config = config;
  }

  /**
   * Analyze market context for a signal
   * @param {Object} data - Market data
   * @param {Object} ruleResult - Result from RuleEngine
   * @returns {Object} - Context analysis and adjusted confidence
   */
  analyze(data, ruleResult) {
    const context = {
      valid: true,
      confidence: 0,
      factors: {},
      warnings: [],
    };

    // EMA trend alignment
    const trendFactor = this.checkTrendAlignment(data, ruleResult.type);
    context.factors.trend = trendFactor;
    if (!trendFactor.aligned) {
      context.warnings.push("Weak trend alignment");
    }

    // ATR volatility check
    const volatilityFactor = this.checkVolatility(data);
    context.factors.volatility = volatilityFactor;
    if (volatilityFactor.tooHigh) {
      context.warnings.push("High volatility - reduce position size");
    }

    // Session filter
    const sessionFactor = this.checkSession();
    context.factors.session = sessionFactor;
    if (!sessionFactor.favorable) {
      context.warnings.push("Outside optimal trading session");
    }

    // Volume confirmation
    const volumeFactor = this.checkVolume(data);
    context.factors.volume = volumeFactor;

    // Support/Resistance proximity
    const levelsFactor = this.checkKeyLevels(data, ruleResult.type);
    context.factors.levels = levelsFactor;

    // Calculate final confidence
    context.confidence = this.calculateConfidence(
      ruleResult,
      context.factors
    );

    // Filter based on minimum confidence
    context.valid = context.confidence >= (this.config.minConfidence || 60);

    return context;
  }

  checkTrendAlignment(data, direction) {
    const ema20 = data.indicators?.ema?.[20];
    const ema50 = data.indicators?.ema?.[50];
    const ema200 = data.indicators?.ema?.[200];

    if (!ema20 || !ema50) {
      return { aligned: false, strength: 0 };
    }

    // Check alignment of EMAs
    const alignedLong = ema20 > ema50 && (!ema200 || ema50 > ema200);
    const alignedShort = ema20 < ema50 && (!ema200 || ema50 < ema200);

    const aligned = direction === "BUY" ? alignedLong : alignedShort;

    // Calculate trend strength
    let strength = 0;
    if (aligned) {
      strength += 30; // Base for alignment
      if (ema20 > ema50) strength += 20;
      if (ema50 > ema200) strength += 20;
    }

    return {
      aligned,
      strength,
      ema20,
      ema50,
      ema200,
    };
  }

  checkVolatility(data) {
    const atr = data.indicators?.atr?.[14];
    const price = data.close;

    if (!atr || !price) {
      return { tooHigh: false, tooLow: false, normalized: 0 };
    }

    // Normalize ATR as percentage of price
    const atrPercent = (atr / price) * 100;

    // Define thresholds
    const tooHigh = atrPercent > 2.0; // More than 2% daily range
    const tooLow = atrPercent < 0.1; // Less than 0.1% daily range

    return {
      tooHigh,
      tooLow,
      normalized: atrPercent,
      atr,
      price,
    };
  }

  checkSession() {
    const now = new Date();
    const utcHour = now.getUTCHours();

    // London session: 08:00 - 17:00 UTC
    const londonOpen = 8;
    const londonClose = 17;

    // New York session: 13:00 - 22:00 UTC
    const nyOpen = 13;
    const nyClose = 22;

    const inLondon = utcHour >= londonOpen && utcHour < londonClose;
    const inNY = utcHour >= nyOpen && utcHour < nyClose;

    // Best liquidity when both sessions overlap
    const overlap = inLondon && inNY;

    return {
      favorable: inLondon || inNY,
      optimal: overlap, // London-NY overlap
      session: inLondon ? "London" : inNY ? "New York" : "Off-hours",
      overlap,
      hour: utcHour,
    };
  }

  checkVolume(data) {
    const currentVolume = data.volume;
    const avgVolume = data.indicators?.avgVolume?.[20];

    if (!currentVolume || !avgVolume) {
      return { confirmed: false, ratio: 1 };
    }

    const ratio = currentVolume / avgVolume;
    const confirmed = ratio > 1.2; // 20% above average

    return {
      confirmed,
      ratio,
      current: currentVolume,
      average: avgVolume,
    };
  }

  checkKeyLevels(data, direction) {
    const { support, resistance } = data.levels || {};
    const price = data.close;

    const results = {
      nearSupport: false,
      nearResistance: false,
      distance: 0,
    };

    if (support && direction === "BUY") {
      const distance = ((price - support) / support) * 100;
      results.nearSupport = distance < 0.5; // Within 0.5% of support
      results.distance = distance;
    }

    if (resistance && direction === "SELL") {
      const distance = ((resistance - price) / price) * 100;
      results.nearResistance = distance < 0.5;
      results.distance = distance;
    }

    return results;
  }

  calculateConfidence(ruleResult, factors) {
    let confidence = 0;

    // Base confidence from rule engine
    const ruleScore = (ruleResult.passed / ruleResult.total) * 50;
    confidence += ruleScore;

    // Trend alignment bonus
    if (factors.trend?.aligned) {
      confidence += factors.trend.strength;
    }

    // Volume confirmation
    if (factors.volume?.confirmed) {
      confidence += 10;
    }

    // Session bonus
    if (factors.session?.optimal) {
      confidence += 10;
    } else if (factors.session?.favorable) {
      confidence += 5;
    }

    // Key levels bonus
    if (factors.levels?.nearSupport || factors.levels?.nearResistance) {
      confidence += 5;
    }

    // Volatility penalty
    if (factors.volatility?.tooHigh) {
      confidence -= 15;
    }

    // Clamp to 0-100
    return Math.max(0, Math.min(100, Math.round(confidence)));
  }
}
