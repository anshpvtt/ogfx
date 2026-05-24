/**
 * Liquidity Map Engine - ELITE VERSION
 * Detects ALL types of liquidity:
 * - External Liquidity (HTF highs/lows)
 * - Internal Liquidity (LTF swing points)
 * - Inducement Liquidity (trap levels)
 * - Equal Highs/Lows
 */

import { logger } from "../../services/logger.js";

export class LiquidityMapEngine {
  constructor(config = {}) {
    this.config = {
      externalLookback: config.externalLookback || 50,
      internalLookback: config.internalLookback || 20,
      inducementLookback: config.inducementLookback || 10,
      tolerance: config.tolerance || 0.0005, // 0.05%
      ...config,
    };
  }

  /**
   * Map all liquidity types
   * @param {Array} candles - Price data
   * @param {Object} htfData - Higher timeframe context
   * @returns {Object} Complete liquidity map
   */
  mapLiquidity(candles, htfData = null) {
    if (!candles || candles.length < 10) {
      return this.getEmptyMap();
    }

    return {
      external: this.detectExternalLiquidity(candles, htfData),
      internal: this.detectInternalLiquidity(candles),
      inducement: this.detectInducementLiquidity(candles),
      equal: this.detectEqualLevels(candles),
      
      // Summary
      strongest: this.findStrongestLiquidity(candles),
      nextTarget: this.findNextTarget(candles, htfData),
      
      // Analysis
      isAccumulating: this.isAccumulatingPhase(candles),
      isDistributing: this.isDistributingPhase(candles),
    };
  }

  /**
   * External Liquidity: HTF significant highs/lows
   * These are major swing points that institutions target
   */
  detectExternalLiquidity(candles, htfData) {
    const lookback = Math.min(candles.length, this.config.externalLookback);
    const range = candles.slice(-lookback);
    
    const highs = range.map((c, i) => ({ price: c.high, index: i, candle: c }));
    const lows = range.map((c, i) => ({ price: c.low, index: i, candle: c }));

    // Find significant highs (must be clear swing points)
    const buySide = this.findSignificantHighs(highs, 3);
    const sellSide = this.findSignificantLows(lows, 3);

    return {
      buySide: buySide.map(h => ({
        level: h.price,
        strength: h.strength,
        touches: h.touches,
        type: 'external_high',
        description: 'HTF significant high'
      })),
      sellSide: sellSide.map(l => ({
        level: l.price,
        strength: l.strength,
        touches: l.touches,
        type: 'external_low',
        description: 'HTF significant low'
      }))
    };
  }

  /**
   * Internal Liquidity: Recent swing points on LTF
   */
  detectInternalLiquidity(candles) {
    const lookback = Math.min(candles.length, this.config.internalLookback);
    const recent = candles.slice(-lookback);
    
    const swings = this.detectSwings(recent);
    const highs = swings.filter(s => s.type === 'high');
    const lows = swings.filter(s => s.type === 'low');

    return {
      buySide: highs.slice(-3).map(h => ({
        level: h.price,
        recency: lookback - h.index,
        type: 'internal_high',
        description: 'Recent swing high'
      })),
      sellSide: lows.slice(-3).map(l => ({
        level: l.price,
        recency: lookback - l.index,
        type: 'internal_low',
        description: 'Recent swing low'
      }))
    };
  }

  /**
   * Inducement Liquidity: Trap levels where retail gets stopped
   * 
   * Logic: Market creates small trend → retail enters → 
   *        stops build → market reverses to take stops
   */
  detectInducementLiquidity(candles) {
    const lookback = this.config.inducementLookback;
    const recent = candles.slice(-lookback);
    
    if (recent.length < 5) return { buySide: [], sellSide: [] };

    const inducements = {
      buySide: [], // Trap highs (for bearish inducement)
      sellSide: [] // Trap lows (for bullish inducement)
    };

    // Detect bullish inducement (fake down move before up)
    const bearishInducement = this.detectBearishInducement(recent);
    if (bearishInducement.valid) {
      inducements.sellSide.push({
        level: bearishInducement.level,
        strength: bearishInducement.strength,
        type: 'inducement_trap',
        description: 'Retail sell stops accumulated',
        scenario: 'Likely bullish reversal coming'
      });
    }

    // Detect bearish inducement (fake up move before down)
    const bullishInducement = this.detectBullishInducement(recent);
    if (bullishInducement.valid) {
      inducements.buySide.push({
        level: bullishInducement.level,
        strength: bullishInducement.strength,
        type: 'inducement_trap',
        description: 'Retail buy stops accumulated',
        scenario: 'Likely bearish reversal coming'
      });
    }

    return inducements;
  }

  /**
   * Detect bearish inducement (setup for bullish move)
   * Pattern: Small downtrend → retail sells → stops below
   */
  detectBearishInducement(candles) {
    const first = candles[0];
    const last = candles[candles.length - 1];
    
    // Check for downtrend
    const isDowntrend = last.close < first.close;
    const dropPercent = ((first.close - last.close) / first.close) * 100;
    
    // Must be small move (1-3% typical for inducement)
    if (!isDowntrend || dropPercent < 0.3 || dropPercent > 3.0) {
      return { valid: false };
    }

    // Check for consolidation at bottom (accumulation)
    const last3 = candles.slice(-3);
    const avgRange = last3.reduce((sum, c) => sum + (c.high - c.low), 0) / 3;
    const prevRange = candles.slice(-6, -3).reduce((sum, c) => sum + (c.high - c.low), 0) / 3;
    
    const isConsolidating = avgRange < prevRange * 0.7; // Tighter range

    // Check for volume pattern (decreasing on drop = no real selling)
    const volumes = candles.map(c => c.volume || 0);
    const avgVolume = volumes.slice(0, -3).reduce((a, b) => a + b, 0) / (volumes.length - 3);
    const recentVolume = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const lowVolumeDrop = recentVolume < avgVolume * 0.8;

    return {
      valid: isDowntrend && (isConsolidating || lowVolumeDrop),
      level: Math.min(...candles.map(c => c.low)),
      strength: (isConsolidating ? 50 : 0) + (lowVolumeDrop ? 50 : 0),
      dropPercent
    };
  }

  /**
   * Detect bullish inducement (setup for bearish move)
   */
  detectBullishInducement(candles) {
    const first = candles[0];
    const last = candles[candles.length - 1];
    
    // Check for uptrend
    const isUptrend = last.close > first.close;
    const risePercent = ((last.close - first.close) / first.close) * 100;
    
    if (!isUptrend || risePercent < 0.3 || risePercent > 3.0) {
      return { valid: false };
    }

    // Check for consolidation at top (distribution)
    const last3 = candles.slice(-3);
    const avgRange = last3.reduce((sum, c) => sum + (c.high - c.low), 0) / 3;
    const prevRange = candles.slice(-6, -3).reduce((sum, c) => sum + (c.high - c.low), 0) / 3;
    
    const isConsolidating = avgRange < prevRange * 0.7;

    // Volume check
    const volumes = candles.map(c => c.volume || 0);
    const avgVolume = volumes.slice(0, -3).reduce((a, b) => a + b, 0) / (volumes.length - 3);
    const recentVolume = volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const lowVolumeRise = recentVolume < avgVolume * 0.8;

    return {
      valid: isUptrend && (isConsolidating || lowVolumeRise),
      level: Math.max(...candles.map(c => c.high)),
      strength: (isConsolidating ? 50 : 0) + (lowVolumeRise ? 50 : 0),
      risePercent
    };
  }

  /**
   * Detect equal highs/lows (classic liquidity)
   */
  detectEqualLevels(candles) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    return {
      highs: this.findEqualValues(highs, this.config.tolerance),
      lows: this.findEqualValues(lows, this.config.tolerance)
    };
  }

  /**
   * Find strongest liquidity pool
   */
  findStrongestLiquidity(candles) {
    if (!candles || candles.length < 10) return null;

    // IMPORTANT: avoid recursion (mapLiquidity() calls findStrongestLiquidity()).
    const external = this.detectExternalLiquidity(candles, null);
    const internal = this.detectInternalLiquidity(candles);
    const inducement = this.detectInducementLiquidity(candles);

    const allLiquidity = [
      ...external.buySide,
      ...external.sellSide,
      ...internal.buySide,
      ...internal.sellSide,
      ...inducement.buySide,
      ...inducement.sellSide,
    ];

    if (allLiquidity.length === 0) return null;

    return allLiquidity.reduce((strongest, current) => {
      const sStrength = strongest.strength || 50;
      const cStrength = current.strength || 50;
      return cStrength > sStrength ? current : strongest;
    });
  }

  /**
   * Find next liquidity target from current price
   */
  findNextTarget(candles, htfData) {
    const current = candles[candles.length - 1].close;
    if (!candles || candles.length < 10) {
      return {
        nextHigh: null,
        nextLow: null,
        distanceToHigh: null,
        distanceToLow: null,
      };
    }

    // IMPORTANT: avoid recursion (mapLiquidity() calls findNextTarget()).
    const external = this.detectExternalLiquidity(candles, htfData);
    const internal = this.detectInternalLiquidity(candles);
    const equal = this.detectEqualLevels(candles);

    // Get all levels above and below
    const above = [
      ...external.buySide.map(l => l.level),
      ...internal.buySide.map(l => l.level),
      ...equal.highs
    ].filter(l => l > current);

    const below = [
      ...external.sellSide.map(l => l.level),
      ...internal.sellSide.map(l => l.level),
      ...equal.lows
    ].filter(l => l < current);

    return {
      nextHigh: above.length > 0 ? Math.min(...above) : null,
      nextLow: below.length > 0 ? Math.max(...below) : null,
      distanceToHigh: above.length > 0 ? ((Math.min(...above) - current) / current) * 100 : null,
      distanceToLow: below.length > 0 ? ((current - Math.max(...below)) / current) * 100 : null
    };
  }

  /**
   * Check if market is in accumulation phase
   */
  isAccumulatingPhase(candles) {
    const recent = candles.slice(-10);
    const range = Math.max(...recent.map(c => c.high)) - Math.min(...recent.map(c => c.low));
    const avgPrice = recent.reduce((sum, c) => sum + c.close, 0) / recent.length;
    const rangePercent = (range / avgPrice) * 100;

    // Tight range with volume drying up
    const tightRange = rangePercent < 1.5;
    
    const volumes = recent.map(c => c.volume || 0);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const prevVol = candles.slice(-20, -10).map(c => c.volume || 0).reduce((a, b) => a + b, 0) / 10;
    const volumeDrying = avgVol < prevVol * 0.7;

    return tightRange && volumeDrying;
  }

  /**
   * Check if market is in distribution phase
   */
  isDistributingPhase(candles) {
    const recent = candles.slice(-10);
    const highs = recent.map(c => c.high);
    const isTopping = highs[highs.length - 1] > highs[0];
    
    const range = Math.max(...recent.map(c => c.high)) - Math.min(...recent.map(c => c.low));
    const avgPrice = recent.reduce((sum, c) => sum + c.close, 0) / recent.length;
    const rangePercent = (range / avgPrice) * 100;

    return isTopping && rangePercent < 2.0;
  }

  /**
   * Helper: Find significant highs
   */
  findSignificantHighs(highs, minTouches) {
    const levels = [];
    const grouped = this.groupByProximity(highs, this.config.tolerance);
    
    for (const group of grouped) {
      if (group.length >= minTouches) {
        const avgPrice = group.reduce((sum, h) => sum + h.price, 0) / group.length;
        const strength = group.length * 20 + (group[0].candle.volume || 0) / 1000;
        levels.push({ price: avgPrice, touches: group.length, strength });
      }
    }

    return levels.sort((a, b) => b.strength - a.strength).slice(0, 3);
  }

  /**
   * Helper: Find significant lows
   */
  findSignificantLows(lows, minTouches) {
    const levels = [];
    const grouped = this.groupByProximity(lows, this.config.tolerance);
    
    for (const group of grouped) {
      if (group.length >= minTouches) {
        const avgPrice = group.reduce((sum, l) => sum + l.price, 0) / group.length;
        const strength = group.length * 20 + (group[0].candle.volume || 0) / 1000;
        levels.push({ price: avgPrice, touches: group.length, strength });
      }
    }

    return levels.sort((a, b) => b.strength - a.strength).slice(0, 3);
  }

  /**
   * Helper: Group prices by proximity
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

      groups.push(group);
    }

    return groups;
  }

  /**
   * Helper: Detect swing points
   */
  detectSwings(candles) {
    const swings = [];
    for (let i = 2; i < candles.length - 2; i++) {
      const c = candles[i];
      const prev = candles.slice(i - 2, i);
      const next = candles.slice(i + 1, i + 3);

      // Swing high
      if (prev.every(x => x.high <= c.high) && next.every(x => x.high <= c.high)) {
        swings.push({ type: 'high', price: c.high, index: i });
      }
      // Swing low
      else if (prev.every(x => x.low >= c.low) && next.every(x => x.low >= c.low)) {
        swings.push({ type: 'low', price: c.low, index: i });
      }
    }
    return swings;
  }

  /**
   * Helper: Find equal values
   */
  findEqualValues(values, tolerance) {
    const equal = [];
    const sorted = [...values].sort((a, b) => a - b);
    
    for (let i = 0; i < sorted.length - 1; i++) {
      const diff = Math.abs(sorted[i] - sorted[i + 1]) / sorted[i];
      if (diff <= tolerance) {
        equal.push((sorted[i] + sorted[i + 1]) / 2);
      }
    }
    
    return [...new Set(equal)];
  }

  getEmptyMap() {
    return {
      external: { buySide: [], sellSide: [] },
      internal: { buySide: [], sellSide: [] },
      inducement: { buySide: [], sellSide: [] },
      equal: { highs: [], lows: [] },
      strongest: null,
      nextTarget: { nextHigh: null, nextLow: null },
      isAccumulating: false,
      isDistributing: false
    };
  }
}
