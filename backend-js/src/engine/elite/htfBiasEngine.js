/**
 * HTF Bias Engine - ELITE VERSION
 * Smart Money Level Analysis with Premium/Discount Zones
 * 
 * Logic: Price above equilibrium = Premium (SELL zone)
 *        Price below equilibrium = Discount (BUY zone)
 */

import { logger } from "../../services/logger.js";

export class HTFBiasEngine {
  constructor(config = {}) {
    this.config = {
      htfTimeframe: config.htfTimeframe || "1h",
      equilibriumMethod: config.equilibriumMethod || "midpoint", // midpoint, vwap, poc
      premiumDiscountThreshold: config.premiumDiscountThreshold || 0.002, // 0.2%
      ...config,
    };
  }

  /**
   * Analyze HTF bias with zone positioning
   * @param {Array} htfCandles - Higher timeframe candles
   * @returns {Object} HTF bias with premium/discount classification
   */
  analyze(htfCandles) {
    if (!htfCandles || htfCandles.length < 10) {
      return this.getDefaultBias();
    }

    const current = htfCandles[htfCandles.length - 1];
    const currentPrice = current.close;

    // 1. Calculate Equilibrium (fair value)
    const equilibrium = this.calculateEquilibrium(htfCandles);

    // 2. Detect Market Structure
    const structure = this.detectStructure(htfCandles);

    // 3. Determine Zone Position
    const zonePosition = this.determineZonePosition(currentPrice, equilibrium);

    // 4. Find liquidity targets
    const liquidityTargets = this.findLiquidityTargets(htfCandles, structure);

    // 5. Calculate Bias Score
    const biasScore = this.calculateBiasScore(structure, zonePosition, currentPrice, equilibrium);

    // 6. Determine Direction
    const direction = this.determineDirection(structure, zonePosition, biasScore);

    return {
      direction, // 'bullish', 'bearish', 'neutral'
      structure: structure.type,
      zonePosition, // 'premium', 'discount', 'equilibrium'
      equilibrium,
      currentPrice,
      distanceFromEQ: ((currentPrice - equilibrium) / equilibrium) * 100,
      liquidityTargets,
      score: biasScore,
      isValid: biasScore >= 60,
      
      // Trading guidance
      tradeDirection: this.getTradeDirection(direction, zonePosition),
      avoidTrading: zonePosition === 'equilibrium',
      
      // Detailed analysis
      details: {
        higherHigh: structure.higherHigh,
        higherLow: structure.higherLow,
        lowerHigh: structure.lowerHigh,
        lowerLow: structure.lowerLow,
        bos: structure.breaks,
        mss: structure.shifts,
      }
    };
  }

  /**
   * Calculate equilibrium (fair value) of the range
   */
  calculateEquilibrium(candles) {
    const lookback = Math.min(candles.length, 20);
    const recent = candles.slice(-lookback);
    
    switch (this.config.equilibriumMethod) {
      case 'vwap':
        return this.calculateVWAP(recent);
      case 'poc':
        return this.calculatePOC(recent);
      case 'midpoint':
      default:
        return this.calculateMidpoint(recent);
    }
  }

  /**
   * Midpoint of range (high + low) / 2
   */
  calculateMidpoint(candles) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);
    return (highest + lowest) / 2;
  }

  /**
   * Volume Weighted Average Price
   */
  calculateVWAP(candles) {
    let typicalSum = 0;
    let volumeSum = 0;
    
    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;
      typicalSum += typical * volume;
      volumeSum += volume;
    }
    
    return typicalSum / volumeSum;
  }

  /**
   * Point of Control (most traded price)
   */
  calculatePOC(candles) {
    // Simplified: use median close price weighted by volume
    const prices = [];
    for (const candle of candles) {
      const weight = Math.ceil((candle.volume || 1) / 1000);
      for (let i = 0; i < weight; i++) {
        prices.push(candle.close);
      }
    }
    prices.sort((a, b) => a - b);
    return prices[Math.floor(prices.length / 2)];
  }

  /**
   * Determine if price is in premium, discount, or equilibrium
   */
  determineZonePosition(price, equilibrium) {
    const diff = price - equilibrium;
    const percent = Math.abs(diff / equilibrium);
    
    if (percent < this.config.premiumDiscountThreshold) {
      return 'equilibrium';
    }
    
    return diff > 0 ? 'premium' : 'discount';
  }

  /**
   * Detect market structure (HH/HL, LH/LL)
   */
  detectStructure(candles) {
    const swings = this.detectSwings(candles);
    const highs = swings.filter(s => s.type === 'high');
    const lows = swings.filter(s => s.type === 'low');
    
    if (highs.length < 2 || lows.length < 2) {
      return {
        type: 'ranging',
        higherHigh: false,
        higherLow: false,
        lowerHigh: false,
        lowerLow: false,
        breaks: [],
        shifts: []
      };
    }

    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];

    const higherHigh = lastHigh.price > prevHigh.price;
    const higherLow = lastLow.price > prevLow.price;
    const lowerHigh = lastHigh.price < prevHigh.price;
    const lowerLow = lastLow.price < prevLow.price;

    // Determine trend
    let type = 'ranging';
    if (higherHigh && higherLow) type = 'bullish';
    else if (lowerHigh && lowerLow) type = 'bearish';
    else if (higherHigh || higherLow) type = 'bullish_bias';
    else if (lowerHigh || lowerLow) type = 'bearish_bias';

    // Detect BOS and MSS
    const breaks = this.detectBOS(candles, highs, lows);
    const shifts = this.detectMSS(candles, lastHigh, lastLow, prevHigh, prevLow);

    return {
      type,
      higherHigh,
      higherLow,
      lowerHigh,
      lowerLow,
      lastHigh,
      lastLow,
      breaks,
      shifts
    };
  }

  /**
   * Detect swing highs and lows
   */
  detectSwings(candles) {
    const swings = [];
    const leftBars = 2;
    const rightBars = 2;

    for (let i = leftBars; i < candles.length - rightBars; i++) {
      const current = candles[i];
      const prev = candles.slice(i - leftBars, i);
      const next = candles.slice(i + 1, i + rightBars + 1);

      // Swing High
      const isHigh = prev.every(c => c.high <= current.high) && 
                     next.every(c => c.high <= current.high);
      if (isHigh) {
        swings.push({ type: 'high', price: current.high, index: i });
        continue;
      }

      // Swing Low
      const isLow = prev.every(c => c.low >= current.low) && 
                    next.every(c => c.low >= current.low);
      if (isLow) {
        swings.push({ type: 'low', price: current.low, index: i });
      }
    }

    return swings;
  }

  /**
   * Detect Break of Structure
   */
  detectBOS(candles, highs, lows) {
    const currentPrice = candles[candles.length - 1].close;
    const breaks = [];

    if (highs.length >= 2) {
      const prevHigh = highs[highs.length - 2];
      if (currentPrice > prevHigh.price) {
        breaks.push({ type: 'bos_up', level: prevHigh.price });
      }
    }

    if (lows.length >= 2) {
      const prevLow = lows[lows.length - 2];
      if (currentPrice < prevLow.price) {
        breaks.push({ type: 'bos_down', level: prevLow.price });
      }
    }

    return breaks;
  }

  /**
   * Detect Market Structure Shift
   */
  detectMSS(candles, lastHigh, lastLow, prevHigh, prevLow) {
    const shifts = [];
    const currentPrice = candles[candles.length - 1].close;

    // Bullish MSS: LL followed by break of previous high
    if (lastLow.price < prevLow.price && currentPrice > prevHigh.price) {
      shifts.push({ type: 'mss_bullish', trigger: currentPrice });
    }

    // Bearish MSS: HH followed by break of previous low
    if (lastHigh.price > prevHigh.price && currentPrice < prevLow.price) {
      shifts.push({ type: 'mss_bearish', trigger: currentPrice });
    }

    return shifts;
  }

  /**
   * Find liquidity targets (next highs/lows to take)
   */
  findLiquidityTargets(candles, structure) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const currentPrice = candles[candles.length - 1].close;

    return {
      nextHigh: Math.max(...highs.slice(-10).filter(h => h > currentPrice)),
      nextLow: Math.min(...lows.slice(-10).filter(l => l < currentPrice)),
      equalHighs: this.findEqualLevels(highs, 0.0005),
      equalLows: this.findEqualLevels(lows, 0.0005)
    };
  }

  /**
   * Find equal levels (liquidity pools)
   */
  findEqualLevels(prices, tolerance) {
    const levels = [];
    const sorted = [...prices].sort((a, b) => a - b);
    
    for (let i = 0; i < sorted.length - 1; i++) {
      const diff = Math.abs(sorted[i] - sorted[i + 1]) / sorted[i];
      if (diff <= tolerance) {
        levels.push((sorted[i] + sorted[i + 1]) / 2);
      }
    }
    
    return [...new Set(levels)];
  }

  /**
   * Calculate bias score (0-100)
   */
  calculateBiasScore(structure, zonePosition, currentPrice, equilibrium) {
    let score = 50; // Base score

    // Structure alignment (30 points)
    if (structure.type === 'bullish') score += 30;
    else if (structure.type === 'bullish_bias') score += 15;
    else if (structure.type === 'bearish') score -= 30;
    else if (structure.type === 'bearish_bias') score -= 15;

    // Zone position (20 points)
    if (zonePosition === 'discount') score += 20;
    else if (zonePosition === 'premium') score -= 20;

    // Distance from equilibrium (10 points)
    const distance = Math.abs((currentPrice - equilibrium) / equilibrium) * 100;
    if (distance > 1.0) score += 10;
    else if (distance > 0.5) score += 5;

    // BOS/MSS presence (10 points)
    if (structure.breaks.length > 0) score += 10;
    if (structure.shifts.length > 0) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Determine overall direction
   */
  determineDirection(structure, zonePosition, score) {
    if (score >= 70) return 'bullish';
    if (score <= 30) return 'bearish';
    
    // Use zone position as tiebreaker
    if (zonePosition === 'discount') return 'bullish';
    if (zonePosition === 'premium') return 'bearish';
    
    return 'neutral';
  }

  /**
   * Get recommended trade direction
   */
  getTradeDirection(bias, zonePosition) {
    if (bias === 'bullish' && zonePosition === 'discount') return 'BUY';
    if (bias === 'bearish' && zonePosition === 'premium') return 'SELL';
    if (bias === 'bullish' && zonePosition === 'equilibrium') return 'BUY_ONLY';
    if (bias === 'bearish' && zonePosition === 'equilibrium') return 'SELL_ONLY';
    return 'NONE';
  }

  /**
   * Get default bias when data insufficient
   */
  getDefaultBias() {
    return {
      direction: 'neutral',
      structure: 'unknown',
      zonePosition: 'equilibrium',
      equilibrium: 0,
      currentPrice: 0,
      distanceFromEQ: 0,
      liquidityTargets: { nextHigh: null, nextLow: null },
      score: 0,
      isValid: false,
      tradeDirection: 'NONE',
      avoidTrading: true,
      details: {}
    };
  }
}
