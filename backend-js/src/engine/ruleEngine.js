/**
 * Rule Engine - Evaluates trading rules from strategy configuration
 * Returns TRUE/FALSE for each rule check
 */

import { logger } from "../services/logger.js";

export class RuleEngine {
  constructor(strategyConfig) {
    this.config = strategyConfig;
  }

  /**
   * Main evaluation method
   * @param {Object} data - Market data with OHLC, indicators
   * @returns {Object} - Rule evaluation results
   */
  evaluate(data) {
    const results = {
      valid: false,
      type: null, // 'BUY' or 'SELL'
      checks: {},
      passed: 0,
      total: 0,
    };

    // Evaluate BUY rules
    const buyResult = this.evaluateDirection(data, "BUY");
    
    // Evaluate SELL rules
    const sellResult = this.evaluateDirection(data, "SELL");

    // Determine signal type
    if (buyResult.valid && !sellResult.valid) {
      results.valid = true;
      results.type = "BUY";
      results.checks = buyResult.checks;
      results.passed = buyResult.passed;
      results.total = buyResult.total;
    } else if (sellResult.valid && !buyResult.valid) {
      results.valid = true;
      results.type = "SELL";
      results.checks = sellResult.checks;
      results.passed = sellResult.passed;
      results.total = sellResult.total;
    }

    return results;
  }

  evaluateDirection(data, direction) {
    const checks = {};
    let passed = 0;
    let total = 0;

    const rules = this.config.rules[direction];
    if (!rules) return { valid: false, checks, passed: 0, total: 0 };

    // Breakout check
    if (rules.breakout) {
      total++;
      const breakoutResult = this.checkBreakout(data, rules.breakout, direction);
      checks.breakout = breakoutResult;
      if (breakoutResult.valid) passed++;
    }

    // RSI check
    if (rules.rsi) {
      total++;
      const rsiResult = this.checkRSI(data, rules.rsi, direction);
      checks.rsi = rsiResult;
      if (rsiResult.valid) passed++;
    }

    // Trend check (EMA)
    if (rules.trend) {
      total++;
      const trendResult = this.checkTrend(data, rules.trend, direction);
      checks.trend = trendResult;
      if (trendResult.valid) passed++;
    }

    // Price action check
    if (rules.priceAction) {
      total++;
      const paResult = this.checkPriceAction(data, rules.priceAction, direction);
      checks.priceAction = paResult;
      if (paResult.valid) passed++;
    }

    // All rules must pass for valid signal
    const valid = passed === total && total > 0;

    return { valid, checks, passed, total };
  }

  checkBreakout(data, config, direction) {
    const { lookback, threshold } = config;
    const current = data.close;
    
    // Calculate high/low over lookback period
    const prices = data.historical || [];
    if (prices.length < lookback) {
      return { valid: false, reason: "Insufficient data" };
    }

    const recent = prices.slice(-lookback);
    const high = Math.max(...recent.map((p) => p.high));
    const low = Math.min(...recent.map((p) => p.low));

    if (direction === "BUY") {
      const breakoutLevel = high - (high - low) * (1 - threshold);
      const valid = current > breakoutLevel;
      return {
        valid,
        current,
        breakoutLevel,
        distance: ((current - high) / high) * 100,
      };
    } else {
      const breakdownLevel = low + (high - low) * (1 - threshold);
      const valid = current < breakdownLevel;
      return {
        valid,
        current,
        breakdownLevel,
        distance: ((current - low) / low) * 100,
      };
    }
  }

  checkRSI(data, config, direction) {
    const { period, overbought, oversold } = config;
    const rsi = data.indicators?.rsi?.[period];

    if (!rsi) {
      return { valid: false, reason: "RSI not available" };
    }

    if (direction === "BUY") {
      // For buy: RSI should be coming from oversold or in neutral zone
      const valid = rsi > oversold && rsi < 55;
      return {
        valid,
        value: rsi,
        threshold: oversold,
        condition: `RSI ${rsi.toFixed(2)} > ${oversold}`,
      };
    } else {
      // For sell: RSI should be coming from overbought or in neutral zone
      const valid = rsi < overbought && rsi > 45;
      return {
        valid,
        value: rsi,
        threshold: overbought,
        condition: `RSI ${rsi.toFixed(2)} < ${overbought}`,
      };
    }
  }

  checkTrend(data, config, direction) {
    const { fastEma, slowEma } = config;
    const fast = data.indicators?.ema?.[fastEma];
    const slow = data.indicators?.ema?.[slowEma];

    if (!fast || !slow) {
      return { valid: false, reason: "EMA not available" };
    }

    if (direction === "BUY") {
      const valid = fast > slow;
      return {
        valid,
        fastEma: fast,
        slowEma: slow,
        spread: ((fast - slow) / slow) * 100,
      };
    } else {
      const valid = fast < slow;
      return {
        valid,
        fastEma: fast,
        slowEma: slow,
        spread: ((slow - fast) / slow) * 100,
      };
    }
  }

  checkPriceAction(data, config, direction) {
    const { minBars, pattern } = config;
    const candles = data.candles || [];

    if (candles.length < minBars) {
      return { valid: false, reason: "Insufficient candles" };
    }

    const recent = candles.slice(-minBars);

    if (pattern === "higherLows" && direction === "BUY") {
      const valid = this.checkHigherLows(recent);
      return { valid, pattern, barsAnalyzed: minBars };
    }

    if (pattern === "lowerHighs" && direction === "SELL") {
      const valid = this.checkLowerHighs(recent);
      return { valid, pattern, barsAnalyzed: minBars };
    }

    return { valid: true, pattern: "none" }; // Default pass
  }

  checkHigherLows(candles) {
    let higherLows = 0;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].low > candles[i - 1].low) higherLows++;
    }
    return higherLows >= candles.length * 0.6; // 60% of candles show higher lows
  }

  checkLowerHighs(candles) {
    let lowerHighs = 0;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].high < candles[i - 1].high) lowerHighs++;
    }
    return lowerHighs >= candles.length * 0.6;
  }
}
