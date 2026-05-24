/**
 * Liquidity Engine - Smart Money Concepts
 * Detects liquidity pools: equal highs, equal lows, previous highs/lows
 * Identifies where stop losses are clustered
 */

import { logger } from "../../services/logger.js";

export class LiquidityEngine {
  constructor(config = {}) {
    this.config = {
      tolerance: config.tolerance || 0.0005, // 0.05% tolerance for equal highs/lows
      lookbackPeriod: config.lookbackPeriod || 30,
      minTouches: config.minTouches || 2,
      ...config,
    };
  }

  /**
   * Main analysis method
   * @param {Array} candles - OHLCV candle data
   * @returns {Object} Liquidity analysis
   */
  analyze(candles) {
    if (!candles || candles.length < this.config.lookbackPeriod) {
      return {
        buySideLiquidity: [],
        sellSideLiquidity: [],
        equalHighs: false,
        equalLows: false,
        rangeHigh: null,
        rangeLow: null,
        recentHighs: [],
        recentLows: [],
      };
    }

    const recentCandles = candles.slice(-this.config.lookbackPeriod);

    // Detect equal highs (buy-side liquidity)
    const buySideLiquidity = this.detectBuySideLiquidity(recentCandles);

    // Detect equal lows (sell-side liquidity)
    const sellSideLiquidity = this.detectSellSideLiquidity(recentCandles);

    // Find range boundaries
    const rangeBounds = this.findRangeBounds(recentCandles, buySideLiquidity, sellSideLiquidity);

    return {
      buySideLiquidity,
      sellSideLiquidity,
      equalHighs: buySideLiquidity.length > 0,
      equalLows: sellSideLiquidity.length > 0,
      rangeHigh: rangeBounds.high,
      rangeLow: rangeBounds.low,
      recentHighs: this.getRecentHighs(recentCandles, 5),
      recentLows: this.getRecentLows(recentCandles, 5),
      strongestLiquidity: this.getStrongestLiquidity(buySideLiquidity, sellSideLiquidity),
    };
  }

  /**
   * Detect buy-side liquidity (equal highs where stops are above)
   */
  detectBuySideLiquidity(candles) {
    const liquidityPools = [];
    const highs = candles.map((c, i) => ({ price: c.high, index: i, candle: c }));

    // Group highs that are close to each other
    const groups = this.groupByProximity(highs, this.config.tolerance);

    for (const group of groups) {
      if (group.length >= this.config.minTouches) {
        const avgPrice = group.reduce((sum, h) => sum + h.price, 0) / group.length;
        const touches = group.length;

        // Calculate liquidity strength based on touches and volume
        const totalVolume = group.reduce((sum, h) => sum + (h.candle.volume || 0), 0);
        const strength = touches * Math.log(totalVolume + 1);

        liquidityPools.push({
          type: "buy_side",
          level: avgPrice,
          touches,
          volume: totalVolume,
          strength,
          candles: group.map((g) => g.index),
          description: `Equal highs with ${touches} touches`,
        });
      }
    }

    // Sort by strength (descending)
    return liquidityPools.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Detect sell-side liquidity (equal lows where stops are below)
   */
  detectSellSideLiquidity(candles) {
    const liquidityPools = [];
    const lows = candles.map((c, i) => ({ price: c.low, index: i, candle: c }));

    // Group lows that are close to each other
    const groups = this.groupByProximity(lows, this.config.tolerance);

    for (const group of groups) {
      if (group.length >= this.config.minTouches) {
        const avgPrice = group.reduce((sum, l) => sum + l.price, 0) / group.length;
        const touches = group.length;

        // Calculate liquidity strength
        const totalVolume = group.reduce((sum, l) => sum + (l.candle.volume || 0), 0);
        const strength = touches * Math.log(totalVolume + 1);

        liquidityPools.push({
          type: "sell_side",
          level: avgPrice,
          touches,
          volume: totalVolume,
          strength,
          candles: group.map((g) => g.index),
          description: `Equal lows with ${touches} touches`,
        });
      }
    }

    // Sort by strength (descending)
    return liquidityPools.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Group prices by proximity tolerance
   */
  groupByProximity(items, tolerance) {
    const groups = [];
    const used = new Set();

    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;

      const group = [items[i]];
      used.add(i);

      for (let j = i + 1; j < items.length; j++) {
        if (used.has(j)) continue;

        const diff = Math.abs(items[i].price - items[j].price) / items[i].price;
        if (diff <= tolerance) {
          group.push(items[j]);
          used.add(j);
        }
      }

      if (group.length >= 1) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * Find range boundaries
   */
  findRangeBounds(candles, buySideLiquidity, sellSideLiquidity) {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const highestLiquidity = buySideLiquidity[0]?.level || Math.max(...highs);
    const lowestLiquidity = sellSideLiquidity[0]?.level || Math.min(...lows);

    return {
      high: highestLiquidity,
      low: lowestLiquidity,
      range: highestLiquidity - lowestLiquidity,
      mid: (highestLiquidity + lowestLiquidity) / 2,
    };
  }

  /**
   * Get recent highs
   */
  getRecentHighs(candles, count) {
    return candles
      .slice(-count)
      .map((c, i) => ({
        price: c.high,
        index: candles.length - count + i,
        timestamp: c.timestamp,
      }))
      .sort((a, b) => b.price - a.price);
  }

  /**
   * Get recent lows
   */
  getRecentLows(candles, count) {
    return candles
      .slice(-count)
      .map((c, i) => ({
        price: c.low,
        index: candles.length - count + i,
        timestamp: c.timestamp,
      }))
      .sort((a, b) => a.price - b.price);
  }

  /**
   * Get strongest liquidity pool
   */
  getStrongestLiquidity(buySide, sellSide) {
    const allLiquidity = [...buySide, ...sellSide];
    if (allLiquidity.length === 0) return null;

    return allLiquidity.reduce((strongest, current) =>
      current.strength > strongest.strength ? current : strongest
    );
  }

  /**
   * Check if price is near a liquidity level
   */
  isNearLiquidity(price, liquidity, tolerance = 0.002) {
    const allLevels = [
      ...liquidity.buySideLiquidity,
      ...liquidity.sellSideLiquidity,
    ];

    for (const level of allLevels) {
      const diff = Math.abs(price - level.level) / level.level;
      if (diff <= tolerance) {
        return {
          isNear: true,
          level: level.level,
          type: level.type,
          distance: diff,
          strength: level.strength,
        };
      }
    }

    return { isNear: false };
  }

  /**
   * Calculate distance to next liquidity pool
   */
  distanceToLiquidity(price, liquidity, direction) {
    const levels = direction === "up"
      ? liquidity.buySideLiquidity.map((l) => l.level)
      : liquidity.sellSideLiquidity.map((l) => l.level);

    if (levels.length === 0) return null;

    const relevantLevels = direction === "up"
      ? levels.filter((l) => l > price)
      : levels.filter((l) => l < price);

    if (relevantLevels.length === 0) return null;

    const target = direction === "up"
      ? Math.min(...relevantLevels)
      : Math.max(...relevantLevels);

    const distance = Math.abs(target - price);
    const percent = (distance / price) * 100;

    return {
      target,
      distance,
      percent,
      rRatio: percent, // Risk as percentage
    };
  }
}
