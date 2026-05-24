/**
 * Displacement Engine - ELITE VERSION
 * Detects institutional entry (strong candles that break structure)
 * 
 * Logic: Large candle body + imbalance + structure break = Smart Money Entry
 */

import { logger } from "../../services/logger.js";

export class DisplacementEngine {
  constructor(config = {}) {
    this.config = {
      minBodyPercent: config.minBodyPercent || 0.6, // 60% body
      minMovePercent: config.minMovePercent || 0.3, // 0.3% move
      imbalanceThreshold: config.imbalanceThreshold || 0.15, // 15% gap
      volumeMultiplier: config.volumeMultiplier || 1.5, // 1.5x avg volume
      ...config,
    };
  }

  /**
   * Detect displacement candles (institutional entries)
   * @param {Array} candles - OHLCV data
   * @param {Object} structure - Market structure context
   * @returns {Object} Displacement analysis
   */
  detect(candles, structure) {
    if (!candles || candles.length < 5) {
      return { bullish: false, bearish: false, strength: 0 };
    }

    const current = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const avgVolume = this.calculateAvgVolume(candles.slice(-10));

    // Check for bullish displacement
    const bullish = this.isBullishDisplacement(current, previous, avgVolume, structure);
    
    // Check for bearish displacement
    const bearish = this.isBearishDisplacement(current, previous, avgVolume, structure);

    // Calculate overall strength
    const strength = this.calculateStrength(bullish, bearish, current, previous);

    return {
      bullish: bullish.valid,
      bearish: bearish.valid,
      bullishDetails: bullish,
      bearishDetails: bearish,
      strength,
      
      // Current candle analysis
      currentCandle: {
        body: Math.abs(current.close - current.open),
        range: current.high - current.low,
        bodyPercent: Math.abs(current.close - current.open) / (current.high - current.low),
        volume: current.volume,
        volumeRatio: current.volume / avgVolume,
      },
      
      // Signal type
      type: bullish.valid ? 'bullish_displacement' : 
            bearish.valid ? 'bearish_displacement' : 'none',
            
      // Quality score (0-100)
      quality: this.calculateQuality(bullish, bearish)
    };
  }

  /**
   * Check for bullish displacement
   * Criteria:
   * 1. Large bullish candle body (60%+ of range)
   * 2. Significant move (0.3%+)
   * 3. High volume (1.5x+ average)
   * 4. Creates imbalance or breaks structure
   */
  isBullishDisplacement(current, previous, avgVolume, structure) {
    const body = current.close - current.open;
    const range = current.high - current.low;
    const bodyPercent = range > 0 ? body / range : 0;
    const movePercent = (body / previous.close) * 100;
    const volumeRatio = current.volume / avgVolume;

    // Check criteria
    const isBullish = body > 0;
    const largeBody = bodyPercent >= this.config.minBodyPercent;
    const significantMove = movePercent >= this.config.minMovePercent;
    const highVolume = volumeRatio >= this.config.volumeMultiplier;

    // Check for imbalance (gap between previous high and current open)
    const imbalance = current.open > previous.high;
    const imbalanceSize = imbalance ? (current.open - previous.high) / previous.close : 0;
    const hasImbalance = imbalance && imbalanceSize >= this.config.imbalanceThreshold / 100;

    // Check structure break
    const breaksStructure = this.breaksBullishStructure(current, structure);

    const valid = isBullish && largeBody && significantMove && 
                  (highVolume || hasImbalance || breaksStructure);

    return {
      valid,
      isBullish,
      largeBody,
      significantMove,
      movePercent,
      highVolume,
      volumeRatio,
      hasImbalance,
      imbalanceSize,
      breaksStructure,
      
      // Scoring
      bodyScore: bodyPercent * 100,
      moveScore: Math.min(movePercent * 50, 40),
      volumeScore: Math.min((volumeRatio - 1) * 50, 30),
      structureScore: breaksStructure ? 20 : 0
    };
  }

  /**
   * Check for bearish displacement
   */
  isBearishDisplacement(current, previous, avgVolume, structure) {
    const body = current.open - current.close;
    const range = current.high - current.low;
    const bodyPercent = range > 0 ? body / range : 0;
    const movePercent = (body / previous.close) * 100;
    const volumeRatio = current.volume / avgVolume;

    const isBearish = body > 0;
    const largeBody = bodyPercent >= this.config.minBodyPercent;
    const significantMove = movePercent >= this.config.minMovePercent;
    const highVolume = volumeRatio >= this.config.volumeMultiplier;

    // Check for imbalance (gap between previous low and current open)
    const imbalance = current.open < previous.low;
    const imbalanceSize = imbalance ? (previous.low - current.open) / previous.close : 0;
    const hasImbalance = imbalance && imbalanceSize >= this.config.imbalanceThreshold / 100;

    // Check structure break
    const breaksStructure = this.breaksBearishStructure(current, structure);

    const valid = isBearish && largeBody && significantMove && 
                  (highVolume || hasImbalance || breaksStructure);

    return {
      valid,
      isBearish,
      largeBody,
      significantMove,
      movePercent,
      highVolume,
      volumeRatio,
      hasImbalance,
      imbalanceSize,
      breaksStructure,
      
      bodyScore: bodyPercent * 100,
      moveScore: Math.min(movePercent * 50, 40),
      volumeScore: Math.min((volumeRatio - 1) * 50, 30),
      structureScore: breaksStructure ? 20 : 0
    };
  }

  /**
   * Check if candle breaks bullish structure
   */
  breaksBullishStructure(candle, structure) {
    if (!structure || !structure.breaks) return false;
    
    // Check for bullish BOS
    return structure.breaks.some(b => b.type === 'bos_up' || b.type === 'mss_bullish');
  }

  /**
   * Check if candle breaks bearish structure
   */
  breaksBearishStructure(candle, structure) {
    if (!structure || !structure.breaks) return false;
    
    // Check for bearish BOS
    return structure.breaks.some(b => b.type === 'bos_down' || b.type === 'mss_bearish');
  }

  /**
   * Calculate average volume
   */
  calculateAvgVolume(candles) {
    if (!candles || candles.length === 0) return 1;
    const sum = candles.reduce((acc, c) => acc + (c.volume || 0), 0);
    return sum / candles.length;
  }

  /**
   * Calculate overall strength (0-100)
   */
  calculateStrength(bullish, bearish, current, previous) {
    const details = bullish.valid ? bullish : bearish.valid ? bearish : null;
    if (!details) return 0;

    let strength = 0;
    strength += details.bodyScore * 0.3;
    strength += details.moveScore;
    strength += details.volumeScore;
    strength += details.structureScore;

    return Math.min(100, Math.round(strength));
  }

  /**
   * Calculate quality grade
   */
  calculateQuality(bullish, bearish) {
    const details = bullish.valid ? bullish : bearish.valid ? bearish : null;
    if (!details) return 0;

    let quality = 0;
    
    // Perfect displacement
    if (details.bodyScore > 70 && details.moveScore > 30 && 
        details.volumeRatio > 2 && details.hasImbalance) {
      quality = 100;
    }
    // Strong displacement
    else if (details.bodyScore > 60 && details.moveScore > 20 && 
             details.volumeRatio > 1.5) {
      quality = 85;
    }
    // Good displacement
    else if (details.bodyScore > 50 && details.moveScore > 15) {
      quality = 70;
    }
    // Weak displacement
    else {
      quality = 50;
    }

    return quality;
  }

  /**
   * Get entry recommendation based on displacement
   */
  getEntryRecommendation(displacement, sweep, zone) {
    if (!displacement.bullish && !displacement.bearish) {
      return { action: 'wait', reason: 'No displacement detected' };
    }

    const direction = displacement.bullish ? 'BUY' : 'SELL';
    const quality = displacement.quality;

    // Perfect setup
    if (quality >= 85 && sweep && zone) {
      return {
        action: 'enter_aggressive',
        direction,
        reason: 'Strong displacement with sweep and zone confluence',
        confidence: 90
      };
    }

    // Good setup
    if (quality >= 70 && sweep) {
      return {
        action: 'enter_standard',
        direction,
        reason: 'Displacement with sweep confirmation',
        confidence: 75
      };
    }

    // Weak displacement
    if (quality >= 50) {
      return {
        action: 'wait_confirmation',
        direction,
        reason: 'Weak displacement - wait for next candle',
        confidence: 50
      };
    }

    return { action: 'skip', reason: 'Insufficient displacement' };
  }
}
