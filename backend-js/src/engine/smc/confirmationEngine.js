/**
 * Confirmation Engine - Smart Money Concepts
 * Validates trade setups after liquidity sweep
 * Detects: Engulfing candles, Break of Structure, Market Structure Shift
 */

import { logger } from "../../services/logger.js";

export class ConfirmationEngine {
  constructor(config = {}) {
    this.config = {
      engulfingThreshold: config.engulfingThreshold || 1.0, // 100% engulfing
      displacementThreshold: config.displacementThreshold || 0.003, // 0.3% move
      minCandleSize: config.minCandleSize || 0.001, // 0.1% minimum candle
      ...config,
    };
  }

  /**
   * Analyze candles for confirmation signals
   * @param {Array} candles - OHLCV candle data
   * @param {Object} structure - Market structure analysis
   * @param {Object} sweep - Sweep detection results
   * @returns {Object} Confirmation analysis
   */
  analyze(candles, structure, sweep) {
    if (!candles || candles.length < 3) {
      return {
        bullish: false,
        bearish: false,
        signals: [],
        strongestSignal: null,
        confidence: 0,
      };
    }

    const current = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    const beforePrevious = candles[candles.length - 3];

    const signals = [];

    // Check for engulfing patterns
    const engulfing = this.checkEngulfing(current, previous);
    if (engulfing.bullish) {
      signals.push({
        type: "engulfing_bullish",
        direction: "bullish",
        confidence: engulfing.confidence,
        description: "Bullish engulfing pattern",
      });
    }
    if (engulfing.bearish) {
      signals.push({
        type: "engulfing_bearish",
        direction: "bearish",
        confidence: engulfing.confidence,
        description: "Bearish engulfing pattern",
      });
    }

    // Check for Break of Structure (BOS)
    const bos = this.checkBOS(candles, structure);
    if (bos.bullish) {
      signals.push({
        type: "bos_up",
        direction: "bullish",
        confidence: bos.confidence,
        description: "Break of structure upward",
        brokenLevel: bos.brokenLevel,
      });
    }
    if (bos.bearish) {
      signals.push({
        type: "bos_down",
        direction: "bearish",
        confidence: bos.confidence,
        description: "Break of structure downward",
        brokenLevel: bos.brokenLevel,
      });
    }

    // Check for Market Structure Shift (MSS/CHoCH)
    const mss = this.checkMSS(candles, structure);
    if (mss.bullish) {
      signals.push({
        type: "mss_up",
        direction: "bullish",
        confidence: mss.confidence,
        description: "Market structure shift bullish",
      });
    }
    if (mss.bearish) {
      signals.push({
        type: "mss_down",
        direction: "bearish",
        confidence: mss.confidence,
        description: "Market structure shift bearish",
      });
    }

    // Check for displacement candles
    const displacement = this.checkDisplacement(current, previous);
    if (displacement.valid) {
      signals.push({
        type: `displacement_${displacement.direction}`,
        direction: displacement.direction,
        confidence: displacement.confidence,
        description: `${displacement.direction} displacement candle`,
        size: displacement.size,
      });
    }

    // Check for pin bars / rejection candles
    const pinBar = this.checkPinBar(current);
    if (pinBar.valid) {
      signals.push({
        type: `pinbar_${pinBar.direction}`,
        direction: pinBar.direction,
        confidence: pinBar.confidence,
        description: `${pinBar.direction} pin bar rejection`,
      });
    }

    // Determine overall confirmation
    const bullish = signals.some((s) => s.direction === "bullish" && s.confidence >= 60);
    const bearish = signals.some((s) => s.direction === "bearish" && s.confidence >= 60);

    // Get strongest signal
    const strongestSignal = signals.length > 0
      ? signals.reduce((prev, current) => (prev.confidence > current.confidence) ? prev : current)
      : null;

    // Calculate overall confidence
    const confidence = this.calculateOverallConfidence(signals, sweep);

    return {
      bullish,
      bearish,
      signals,
      strongestSignal,
      confidence,
      signalCount: signals.length,
    };
  }

  /**
   * Check for engulfing candle pattern
   */
  checkEngulfing(current, previous) {
    const prevBody = Math.abs(previous.close - previous.open);
    const currBody = Math.abs(current.close - current.open);

    const prevBullish = previous.close > previous.open;
    const currBullish = current.close > current.open;

    // Bullish engulfing: current bullish candle engulfs previous bearish candle
    const bullishEngulfing =
      !prevBullish &&
      currBullish &&
      current.open < previous.close &&
      current.close > previous.open &&
      currBody >= prevBody * this.config.engulfingThreshold;

    // Bearish engulfing: current bearish candle engulfs previous bullish candle
    const bearishEngulfing =
      prevBullish &&
      !currBullish &&
      current.open > previous.close &&
      current.close < previous.open &&
      currBody >= prevBody * this.config.engulfingThreshold;

    return {
      bullish: bullishEngulfing,
      bearish: bearishEngulfing,
      confidence: bullishEngulfing || bearishEngulfing
        ? Math.min(100, 70 + (currBody / prevBody - 1) * 20)
        : 0,
    };
  }

  /**
   * Check for Break of Structure (BOS)
   */
  checkBOS(candles, structure) {
    const current = candles[candles.length - 1];
    const currentPrice = current.close;

    let bullish = false;
    let bearish = false;
    let brokenLevel = null;
    let confidence = 0;

    // Check for bullish BOS - price breaks above previous high
    if (structure.lastHigh && currentPrice > structure.lastHigh.price) {
      bullish = true;
      brokenLevel = structure.lastHigh.price;
      confidence = 75;
    }

    // Check for bearish BOS - price breaks below previous low
    if (structure.lastLow && currentPrice < structure.lastLow.price) {
      bearish = true;
      brokenLevel = structure.lastLow.price;
      confidence = 75;
    }

    return { bullish, bearish, brokenLevel, confidence };
  }

  /**
   * Check for Market Structure Shift (MSS/CHoCH)
   */
  checkMSS(candles, structure) {
    const current = candles[candles.length - 1];
    const currentPrice = current.close;

    let bullish = false;
    let bearish = false;
    let confidence = 0;

    // Check structure breaks from shifts array
    if (structure.shifts && structure.shifts.length > 0) {
      const lastShift = structure.shifts[structure.shifts.length - 1];

      if (lastShift.type === "mss_bullish") {
        bullish = true;
        confidence = 80;
      } else if (lastShift.type === "mss_bearish") {
        bearish = true;
        confidence = 80;
      }
    }

    // Additional MSS detection based on trend change
    if (structure.patterns) {
      // Bullish MSS: Lower low followed by higher high
      if (structure.patterns.lowerLow && currentPrice > structure.lastHigh?.price) {
        bullish = true;
        confidence = Math.max(confidence, 70);
      }

      // Bearish MSS: Higher high followed by lower low
      if (structure.patterns.higherHigh && currentPrice < structure.lastLow?.price) {
        bearish = true;
        confidence = Math.max(confidence, 70);
      }
    }

    return { bullish, bearish, confidence };
  }

  /**
   * Check for displacement candle (large momentum move)
   */
  checkDisplacement(current, previous) {
    const priceChange = Math.abs(current.close - previous.close);
    const prevClose = previous.close;
    const percentMove = priceChange / prevClose;

    const isLarge = percentMove >= this.config.displacementThreshold;
    const direction = current.close > previous.close ? "bullish" : "bearish";

    return {
      valid: isLarge,
      direction,
      confidence: isLarge ? Math.min(100, 60 + (percentMove / this.config.displacementThreshold - 1) * 20) : 0,
      size: percentMove,
    };
  }

  /**
   * Check for pin bar / rejection candle
   */
  checkPinBar(candle) {
    const range = candle.high - candle.low;
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);

    if (range === 0) return { valid: false };

    const bodyPercent = body / range;
    const lowerWickPercent = lowerWick / range;
    const upperWickPercent = upperWick / range;

    // Bullish pin bar: long lower wick, small body at top
    const bullishPinBar =
      lowerWickPercent > 0.6 &&
      bodyPercent < 0.2 &&
      candle.close > candle.open;

    // Bearish pin bar: long upper wick, small body at bottom
    const bearishPinBar =
      upperWickPercent > 0.6 &&
      bodyPercent < 0.2 &&
      candle.close < candle.open;

    if (bullishPinBar) {
      return {
        valid: true,
        direction: "bullish",
        confidence: 75 + lowerWickPercent * 20,
      };
    }

    if (bearishPinBar) {
      return {
        valid: true,
        direction: "bearish",
        confidence: 75 + upperWickPercent * 20,
      };
    }

    return { valid: false };
  }

  /**
   * Calculate overall confirmation confidence
   */
  calculateOverallConfidence(signals, sweep) {
    if (signals.length === 0) return 0;

    // Base confidence from signals
    let confidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;

    // Bonus for multiple confirmations
    if (signals.length >= 2) confidence += 10;
    if (signals.length >= 3) confidence += 10;

    // Bonus if sweep and confirmation align
    if (sweep && sweep.lastSweep) {
      const sweepDirection = sweep.lastSweep.direction;
      const confirmationDirection = signals[0].direction;

      if (sweepDirection === confirmationDirection) {
        confidence += 15; // Alignment bonus
      }
    }

    return Math.min(100, confidence);
  }
}
