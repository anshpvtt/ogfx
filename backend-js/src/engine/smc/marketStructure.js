/**
 * Market Structure Engine - SMC Smart Money Concepts
 * Detects Higher Highs (HH), Higher Lows (HL), Lower Highs (LH), Lower Lows (LL)
 * Determines bullish, bearish, or ranging market structure
 */

import { logger } from "../../services/logger.js";

export class MarketStructureEngine {
  constructor(config = {}) {
    this.config = {
      lookbackPeriod: config.lookbackPeriod || 20,
      minSwingSize: config.minSwingSize || 0.001, // 0.1% minimum swing
      ...config,
    };
  }

  /**
   * Main analysis method
   * @param {Array} candles - OHLCV candle data
   * @returns {Object} Market structure analysis
   */
  analyze(candles) {
    if (!candles || candles.length < this.config.lookbackPeriod) {
      return {
        trend: "unknown",
        structure: null,
        swings: [],
        lastHigh: null,
        lastLow: null,
      };
    }

    // Detect swing highs and lows
    const swings = this.detectSwings(candles);

    // Determine market structure
    const structure = this.determineStructure(swings, candles);

    return {
      trend: structure.trend,
      structure: structure.type,
      swings,
      lastHigh: structure.lastHigh,
      lastLow: structure.lastLow,
      breaks: structure.breaks,
      shifts: structure.shifts,
    };
  }

  /**
   * Detect swing highs and lows using pivot points
   */
  detectSwings(candles) {
    const swings = [];
    const leftBars = 2;
    const rightBars = 2;

    for (let i = leftBars; i < candles.length - rightBars; i++) {
      const current = candles[i];
      const prev = candles.slice(i - leftBars, i);
      const next = candles.slice(i + 1, i + rightBars + 1);

      // Check for swing high
      const isSwingHigh = prev.every((c) => c.high <= current.high) &&
                          next.every((c) => c.high <= current.high);

      if (isSwingHigh) {
        swings.push({
          type: "high",
          price: current.high,
          index: i,
          timestamp: current.timestamp,
        });
        continue;
      }

      // Check for swing low
      const isSwingLow = prev.every((c) => c.low >= current.low) &&
                         next.every((c) => c.low >= current.low);

      if (isSwingLow) {
        swings.push({
          type: "low",
          price: current.low,
          index: i,
          timestamp: current.timestamp,
        });
      }
    }

    return swings;
  }

  /**
   * Determine market structure from swings
   */
  determineStructure(swings, candles) {
    if (swings.length < 4) {
      return {
        trend: "ranging",
        type: "insufficient_data",
        lastHigh: null,
        lastLow: null,
        breaks: [],
        shifts: [],
      };
    }

    const recentSwings = swings.slice(-10); // Last 10 swings
    const highs = recentSwings.filter((s) => s.type === "high");
    const lows = recentSwings.filter((s) => s.type === "low");

    if (highs.length < 2 || lows.length < 2) {
      return {
        trend: "ranging",
        type: "insufficient_swings",
        lastHigh: highs[highs.length - 1] || null,
        lastLow: lows[lows.length - 1] || null,
        breaks: [],
        shifts: [],
      };
    }

    // Get last significant swings
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];

    // Detect breaks of structure (BOS)
    const breaks = this.detectBOS(candles, swings, lastHigh, lastLow);

    // Detect market structure shifts (MSS/CHoCH)
    const shifts = this.detectMSS(candles, swings, lastHigh, lastLow, prevHigh, prevLow);

    // Determine trend
    let trend = "ranging";
    let type = "range";

    // Bullish structure: HH + HL
    const isHigherHigh = lastHigh.price > prevHigh.price;
    const isHigherLow = lastLow.price > prevLow.price;

    // Bearish structure: LH + LL
    const isLowerHigh = lastHigh.price < prevHigh.price;
    const isLowerLow = lastLow.price < prevLow.price;

    if (isHigherHigh && isHigherLow) {
      trend = "bullish";
      type = "uptrend";
    } else if (isLowerHigh && isLowerLow) {
      trend = "bearish";
      type = "downtrend";
    } else if (isHigherHigh || isHigherLow) {
      trend = "bullish_bias";
      type = "weak_uptrend";
    } else if (isLowerHigh || isLowerLow) {
      trend = "bearish_bias";
      type = "weak_downtrend";
    }

    return {
      trend,
      type,
      lastHigh,
      lastLow,
      breaks,
      shifts,
      patterns: {
        higherHigh: isHigherHigh,
        higherLow: isHigherLow,
        lowerHigh: isLowerHigh,
        lowerLow: isLowerLow,
      },
    };
  }

  /**
   * Detect Break of Structure (BOS)
   * BOS Up: Price breaks above previous high in bullish trend
   * BOS Down: Price breaks below previous low in bearish trend
   */
  detectBOS(candles, swings, lastHigh, lastLow) {
    const breaks = [];
    const currentPrice = candles[candles.length - 1].close;

    // Find previous significant levels
    const highs = swings.filter((s) => s.type === "high").slice(-3);
    const lows = swings.filter((s) => s.type === "low").slice(-3);

    if (highs.length >= 2) {
      const prevHigh = highs[highs.length - 2];
      if (currentPrice > prevHigh.price) {
        breaks.push({
          type: "bos_up",
          direction: "bullish",
          brokenLevel: prevHigh.price,
          currentPrice,
          timestamp: candles[candles.length - 1].timestamp,
        });
      }
    }

    if (lows.length >= 2) {
      const prevLow = lows[lows.length - 2];
      if (currentPrice < prevLow.price) {
        breaks.push({
          type: "bos_down",
          direction: "bearish",
          brokenLevel: prevLow.price,
          currentPrice,
          timestamp: candles[candles.length - 1].timestamp,
        });
      }
    }

    return breaks;
  }

  /**
   * Detect Market Structure Shift (MSS / CHoCH)
   * MSS: Change of character - shift from bullish to bearish or vice versa
   */
  detectMSS(candles, swings, lastHigh, lastLow, prevHigh, prevLow) {
    const shifts = [];
    const currentPrice = candles[candles.length - 1].close;
    const currentCandle = candles[candles.length - 1];

    // Bullish MSS: Price was making LL, now takes out previous high
    if (lastLow.price < prevLow.price && currentPrice > prevHigh.price) {
      shifts.push({
        type: "mss_bullish",
        description: "Bullish shift - broke previous high after lower low",
        triggerPrice: currentPrice,
        previousHigh: prevHigh.price,
        timestamp: currentCandle.timestamp,
      });
    }

    // Bearish MSS: Price was making HH, now takes out previous low
    if (lastHigh.price > prevHigh.price && currentPrice < prevLow.price) {
      shifts.push({
        type: "mss_bearish",
        description: "Bearish shift - broke previous low after higher high",
        triggerPrice: currentPrice,
        previousLow: prevLow.price,
        timestamp: currentCandle.timestamp,
      });
    }

    return shifts;
  }

  /**
   * Get current market bias
   */
  getBias(structure) {
    if (!structure) return "neutral";

    if (structure.trend === "bullish" || structure.trend === "bullish_bias") {
      return "bullish";
    }

    if (structure.trend === "bearish" || structure.trend === "bearish_bias") {
      return "bearish";
    }

    return "neutral";
  }

  /**
   * Detect if price is at key structural level
   */
  isAtKeyLevel(price, structure, tolerance = 0.002) {
    if (!structure || !structure.swings) return false;

    const recentSwings = structure.swings.slice(-6);

    for (const swing of recentSwings) {
      const diff = Math.abs(price - swing.price) / swing.price;
      if (diff <= tolerance) {
        return {
          isAtLevel: true,
          level: swing.price,
          type: swing.type,
          distance: diff,
        };
      }
    }

    return { isAtLevel: false };
  }
}
