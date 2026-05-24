/**
 * Liquidity Sweep Detector - Smart Money Concepts
 * Detects when price sweeps liquidity (takes out stops) then reverses
 * Key signal for institutional manipulation detection
 */

import { logger } from "../../services/logger.js";

export class SweepDetector {
  constructor(config = {}) {
    this.config = {
      wickThreshold: config.wickThreshold || 0.3, // 30% of candle as wick
      closeThreshold: config.closeThreshold || 0.001, // 0.1% close back threshold
      minSweepDistance: config.minSweepDistance || 0.0005, // Minimum sweep distance
      ...config,
    };
  }

  /**
   * Detect liquidity sweeps
   * @param {Array} candles - OHLCV candle data
   * @param {Object} liquidity - Liquidity analysis from LiquidityEngine
   * @returns {Object} Sweep detection results
   */
  detect(candles, liquidity) {
    if (!candles || candles.length < 3 || !liquidity) {
      return {
        sweepBelow: false,
        sweepAbove: false,
        sweeps: [],
        lastSweep: null,
      };
    }

    const currentCandle = candles[candles.length - 1];
    const previousCandle = candles[candles.length - 2];
    const sweeps = [];

    // Check for sell-side liquidity sweep (buy setup)
    const sellSideSweep = this.checkSellSideSweep(
      currentCandle,
      previousCandle,
      liquidity.sellSideLiquidity
    );

    if (sellSideSweep.valid) {
      sweeps.push({
        type: "sell_side_sweep",
        direction: "bullish",
        description: "Price swept below equal lows then closed back above",
        level: sellSideSweep.level,
        wickLow: sellSideSweep.wickLow,
        closePrice: currentCandle.close,
        candle: currentCandle,
        strength: sellSideSweep.strength,
      });
    }

    // Check for buy-side liquidity sweep (sell setup)
    const buySideSweep = this.checkBuySideSweep(
      currentCandle,
      previousCandle,
      liquidity.buySideLiquidity
    );

    if (buySideSweep.valid) {
      sweeps.push({
        type: "buy_side_sweep",
        direction: "bearish",
        description: "Price swept above equal highs then closed back below",
        level: buySideSweep.level,
        wickHigh: buySideSweep.wickHigh,
        closePrice: currentCandle.close,
        candle: currentCandle,
        strength: buySideSweep.strength,
      });
    }

    return {
      sweepBelow: sellSideSweep.valid,
      sweepAbove: buySideSweep.valid,
      sweeps,
      lastSweep: sweeps[sweeps.length - 1] || null,
      details: {
        sellSide: sellSideSweep,
        buySide: buySideSweep,
      },
    };
  }

  /**
   * Check for sell-side liquidity sweep
   * Valid when:
   * 1. Wick goes below equal lows
   * 2. Closes back above the level
   * 3. Significant wick size
   */
  checkSellSideSweep(current, previous, sellSideLiquidity) {
    if (!sellSideLiquidity || sellSideLiquidity.length === 0) {
      return { valid: false, reason: "No sell-side liquidity detected" };
    }

    const strongestLevel = sellSideLiquidity[0];
    const level = strongestLevel.level;

    // Check if wick went below the level
    const wickBelow = current.low < level;

    // Check if close is back above
    const closedAbove = current.close > level;

    // Calculate wick size
    const candleRange = current.high - current.low;
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const wickPercent = candleRange > 0 ? lowerWick / candleRange : 0;
    const hasSignificantWick = wickPercent >= this.config.wickThreshold;

    // Calculate sweep distance
    const sweepDistance = level - current.low;
    const sweepPercent = sweepDistance / level;
    const hasEnoughSweep = sweepPercent >= this.config.minSweepDistance;

    // Valid sweep check
    const valid = wickBelow && closedAbove && hasSignificantWick && hasEnoughSweep;

    return {
      valid,
      level,
      wickLow: current.low,
      wickPercent,
      sweepDistance,
      sweepPercent,
      strength: valid ? this.calculateSweepStrength(current, level, "sell") : 0,
      reason: valid ? null : this.getInvalidReason(wickBelow, closedAbove, hasSignificantWick, hasEnoughSweep),
    };
  }

  /**
   * Check for buy-side liquidity sweep
   * Valid when:
   * 1. Wick goes above equal highs
   * 2. Closes back below the level
   * 3. Significant wick size
   */
  checkBuySideSweep(current, previous, buySideLiquidity) {
    if (!buySideLiquidity || buySideLiquidity.length === 0) {
      return { valid: false, reason: "No buy-side liquidity detected" };
    }

    const strongestLevel = buySideLiquidity[0];
    const level = strongestLevel.level;

    // Check if wick went above the level
    const wickAbove = current.high > level;

    // Check if close is back below
    const closedBelow = current.close < level;

    // Calculate wick size
    const candleRange = current.high - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    const wickPercent = candleRange > 0 ? upperWick / candleRange : 0;
    const hasSignificantWick = wickPercent >= this.config.wickThreshold;

    // Calculate sweep distance
    const sweepDistance = current.high - level;
    const sweepPercent = sweepDistance / level;
    const hasEnoughSweep = sweepPercent >= this.config.minSweepDistance;

    // Valid sweep check
    const valid = wickAbove && closedBelow && hasSignificantWick && hasEnoughSweep;

    return {
      valid,
      level,
      wickHigh: current.high,
      wickPercent,
      sweepDistance,
      sweepPercent,
      strength: valid ? this.calculateSweepStrength(current, level, "buy") : 0,
      reason: valid ? null : this.getInvalidReason(wickAbove, closedBelow, hasSignificantWick, hasEnoughSweep),
    };
  }

  /**
   * Calculate sweep strength based on wick size and volume
   */
  calculateSweepStrength(candle, level, type) {
    const candleRange = candle.high - candle.low;
    const bodyRange = Math.abs(candle.close - candle.open);
    const wickToBodyRatio = bodyRange > 0 ? candleRange / bodyRange : 1;

    // Volume factor (higher volume = stronger sweep)
    const volumeFactor = Math.log((candle.volume || 1) + 1) / 10;

    // Sweep depth
    const sweepDepth = type === "sell"
      ? (level - candle.low) / level * 100
      : (candle.high - level) / level * 100;

    // Combined strength (0-100)
    const strength = Math.min(100, (
      wickToBodyRatio * 30 +
      sweepDepth * 5 +
      volumeFactor * 20 +
      30 // Base strength for valid sweep
    ));

    return Math.round(strength);
  }

  /**
   * Get reason for invalid sweep
   */
  getInvalidReason(wickBeyond, closedBack, significantWick, enoughSweep) {
    if (!wickBeyond) return "Wick did not go beyond liquidity level";
    if (!closedBack) return "Price did not close back inside range";
    if (!significantWick) return "Wick size insufficient";
    if (!enoughSweep) return "Sweep distance too small";
    return "Unknown";
  }

  /**
   * Check if sweep is fresh (not recently swept)
   */
  isFreshSweep(candles, sweep, lookback = 10) {
    if (!sweep || !sweep.level) return false;

    const recentCandles = candles.slice(-lookback - 1, -1);

    for (const candle of recentCandles) {
      // Check if price previously swept this level
      if (sweep.type === "sell_side_sweep") {
        if (candle.low < sweep.level && candle.close > sweep.level) {
          return false; // Already swept recently
        }
      } else {
        if (candle.high > sweep.level && candle.close < sweep.level) {
          return false; // Already swept recently
        }
      }
    }

    return true;
  }

  /**
   * Get sweep quality score
   */
  getSweepQuality(sweep) {
    if (!sweep || !sweep.valid) return 0;

    let score = 50; // Base score

    // Bonus for strong wick
    if (sweep.wickPercent > 0.5) score += 15;
    else if (sweep.wickPercent > 0.3) score += 10;

    // Bonus for deep sweep
    if (sweep.sweepPercent > 0.001) score += 15;
    else if (sweep.sweepPercent > 0.0005) score += 10;

    // Bonus for strength
    if (sweep.strength > 80) score += 20;
    else if (sweep.strength > 60) score += 10;

    return Math.min(100, score);
  }
}
