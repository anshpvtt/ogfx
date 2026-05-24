/**
 * ELITE SIGNAL ENGINE - Multi-Layer Filter System
 * 
 * Architecture:
 * BIAS ENGINE (HTF) → LIQUIDITY ENGINE → INDUCEMENT ENGINE → SWEEP ENGINE → 
 * CONFIRMATION ENGINE → EXECUTION ENGINE → RISK ENGINE
 * 
 * Each layer filters trades. Only BEST trades survive.
 * Target: 85+ confidence = A+ grade trades
 */

import { HTFBiasEngine } from './htfBiasEngine.js';
import { LiquidityMapEngine } from './liquidityMapEngine.js';
import { DisplacementEngine } from './displacementEngine.js';
import { EliteRiskEngine } from './riskEngine.js';
import { logger } from "../../services/logger.js";

// Import existing SMC engines for sweep and confirmation
import { SweepDetector } from '../smc/sweepDetector.js';
import { ConfirmationEngine } from '../smc/confirmationEngine.js';
import { ZoneDetector } from '../smc/zoneDetector.js';

export class EliteSignalEngine {
  constructor(config = {}) {
    // Initialize all layer engines
    this.htfEngine = new HTFBiasEngine(config.htf);
    this.liquidityEngine = new LiquidityMapEngine(config.liquidity);
    this.sweepDetector = new SweepDetector(config.sweep);
    this.confirmationEngine = new ConfirmationEngine(config.confirmation);
    this.displacementEngine = new DisplacementEngine(config.displacement);
    this.zoneDetector = new ZoneDetector(config.zones);
    this.riskEngine = new EliteRiskEngine(config.risk);

    this.config = {
      minConfidence: config.minConfidence || 85, // A+ grade threshold
      requireAllLayers: config.requireAllLayers ?? true,
      ...config,
    };

    this.onSignalGenerated = null;
  }

  /**
   * Main analysis - Multi-layer filter
   * Only trades passing ALL layers generate signals
   */
  analyze(symbol, data) {
    try {
      const candles = data.candles || data;
      const currentPrice = candles[candles.length - 1].close;

      // Layer 1: HTF BIAS ENGINE
      const htfCandles = this.createHTFCandles(candles, 4);
      const bias = this.htfEngine.analyze(htfCandles);
      
      if (!bias.isValid) {
        return this.createRejectResult('HTF_BIAS', 'HTF bias unclear or weak', { bias });
      }

      // Layer 2: LIQUIDITY MAP ENGINE
      const liquidity = this.liquidityEngine.mapLiquidity(candles, bias);
      
      if (!liquidity.strongest) {
        return this.createRejectResult('LIQUIDITY', 'No significant liquidity found', { bias, liquidity });
      }

      // Layer 3: CHECK INDUCEMENT
      const inducement = this.detectInducement(candles, liquidity);

      // Layer 4: SWEEP ENGINE
      const sweep = this.sweepDetector.detect(candles, {
        buySideLiquidity: liquidity.external.buySide,
        sellSideLiquidity: liquidity.external.sellSide,
        equalHighs: liquidity.equal.highs.length > 0,
        equalLows: liquidity.equal.lows.length > 0,
      });

      // Valid sweep near zone?
      const zones = this.zoneDetector.detect(candles);
      const validSweep = this.validateSweep(sweep, zones, currentPrice);
      
      if (!validSweep.valid) {
        return this.createRejectResult('SWEEP', validSweep.reason, { bias, liquidity, sweep });
      }

      // Layer 5: DISPLACEMENT ENGINE (Institutional Entry)
      const structure = bias.details;
      const displacement = this.displacementEngine.detect(candles, structure);

      // Layer 6: CONFIRMATION ENGINE
      const confirmation = this.confirmationEngine.analyze(candles, structure, sweep);

      // Layer 7: ELITE ENTRY MODEL (5 conditions)
      const entryModel = this.evaluateEntryModel({
        bias,
        liquidity,
        inducement,
        sweep,
        displacement,
        confirmation,
        zones,
        currentPrice,
      });

      if (!entryModel.valid) {
        return this.createRejectResult('ENTRY_MODEL', entryModel.reason, entryModel);
      }

      // Layer 8: RISK ENGINE
      const riskCheck = this.riskEngine.canTrade();
      if (!riskCheck.allowed) {
        return this.createRejectResult('RISK', riskCheck.reason, { riskCheck });
      }

      // Calculate ELITE confidence score
      const confidence = this.calculateEliteConfidence({
        bias,
        liquidity,
        inducement,
        sweep,
        displacement,
        confirmation,
        zones,
        entryModel,
      });

      // Must be A+ grade (85+)
      if (confidence < this.config.minConfidence) {
        return this.createRejectResult('CONFIDENCE', `Confidence ${confidence}% < ${this.config.minConfidence}%`, { confidence });
      }

      // Generate ELITE signal
      const signal = this.generateEliteSignal({
        symbol,
        currentPrice,
        bias,
        liquidity,
        inducement,
        sweep,
        displacement,
        confirmation,
        zones,
        confidence,
        entryModel,
      });

      // Validate against risk engine
      const signalValidation = this.riskEngine.validateSignal(signal);
      if (!signalValidation.valid) {
        return this.createRejectResult('SIGNAL_RISK', signalValidation.reason, { signalValidation });
      }

      // Success - trigger callback
      if (this.onSignalGenerated) {
        this.onSignalGenerated(signal);
      }

      return {
        valid: true,
        signal,
        layers: {
          bias: true,
          liquidity: true,
          inducement: inducement.present,
          sweep: true,
          displacement: displacement.bullish || displacement.bearish,
          confirmation: confirmation.bullish || confirmation.bearish,
          entryModel: true,
          risk: true,
        },
        confidence,
        grade: this.getGrade(confidence),
      };

    } catch (error) {
      logger.error(`Elite analysis failed for ${symbol}:`, error);
      return { valid: false, error: error.message };
    }
  }

  /**
   * Evaluate the 5-condition entry model
   */
  evaluateEntryModel(data) {
    const { bias, liquidity, sweep, displacement, confirmation, zones, currentPrice } = data;

    const conditions = {
      htfAligned: bias.direction !== 'neutral',
      inDiscountPremium: bias.zonePosition === 'discount' || bias.zonePosition === 'premium',
      liquidityPresent: liquidity.strongest !== null,
      sweepValid: sweep.lastSweep !== null,
      displacementConfirmed: displacement.bullish || displacement.bearish,
      confirmationValid: confirmation.bullish || confirmation.bearish,
    };

    // Count met conditions
    const metConditions = Object.values(conditions).filter(Boolean).length;
    const totalConditions = Object.keys(conditions).length;

    // Perfect entry = 5+ conditions
    if (metConditions >= 5) {
      return {
        valid: true,
        type: 'PERFECT',
        conditions,
        metConditions,
        reason: 'Perfect entry - 5/6 conditions met',
      };
    }

    // Good entry = 4 conditions
    if (metConditions >= 4) {
      return {
        valid: true,
        type: 'GOOD',
        conditions,
        metConditions,
        reason: 'Good entry - 4/6 conditions met',
      };
    }

    // Reject if < 4 conditions
    return {
      valid: false,
      type: 'REJECT',
      conditions,
      metConditions,
      reason: `Only ${metConditions}/6 conditions met - need 4+`,
    };
  }

  /**
   * Calculate ELITE confidence (85+ = A+ grade)
   */
  calculateEliteConfidence(data) {
    const { bias, liquidity, inducement, sweep, displacement, confirmation, zones, entryModel } = data;

    let score = 0;

    // HTF Alignment (20 points)
    score += bias.score * 0.2;

    // Zone Position (20 points)
    if (bias.zonePosition === 'discount' && bias.direction === 'bullish') score += 20;
    else if (bias.zonePosition === 'premium' && bias.direction === 'bearish') score += 20;
    else if (bias.zonePosition !== 'equilibrium') score += 10;

    // Liquidity Clarity (15 points)
    if (liquidity.strongest) {
      score += Math.min(15, liquidity.strongest.strength / 10);
    }

    // Inducement Present (15 points) - BONUS
    if (inducement.present) score += 15;

    // Sweep Quality (15 points)
    if (sweep.lastSweep) {
      score += Math.min(15, sweep.lastSweep.strength / 5);
    }

    // Displacement Strength (15 points)
    if (displacement.bullish || displacement.bearish) {
      score += displacement.strength * 0.15;
    }

    // Extra for perfect entry model
    if (entryModel.type === 'PERFECT') score += 10;

    return Math.round(Math.min(100, score));
  }

  /**
   * Generate elite signal with all data
   */
  generateEliteSignal(data) {
    const { symbol, currentPrice, bias, liquidity, inducement, sweep, displacement, confirmation, zones, confidence, entryModel } = data;

    // Determine direction
    const direction = this.determineDirection(bias, displacement, confirmation);

    // Calculate levels
    const levels = this.calculateLevels(direction, currentPrice, liquidity, zones, sweep);

    // Calculate targets
    const targets = this.calculateTargets(direction, currentPrice, liquidity, bias);

    // Build reasons
    const reasons = this.buildReasons(data);

    return {
      id: `ELITE-${symbol}-${Date.now()}`,
      pair: symbol,
      type: direction,
      entry: levels.entry,
      stopLoss: levels.sl,
      takeProfit: targets.tp1, // Primary target
      takeProfit2: targets.tp2,
      takeProfit3: targets.tp3,
      confidence,
      riskReward: targets.riskReward,
      grade: this.getGrade(confidence),
      
      reason: reasons.primary,
      detailedReasons: reasons.detailed,
      timestamp: new Date().toISOString(),
      status: 'ACTIVE',

      // Elite data
      eliteData: {
        bias: {
          direction: bias.direction,
          zonePosition: bias.zonePosition,
          score: bias.score,
          structure: bias.structure,
        },
        liquidity: {
          type: liquidity.strongest?.type || 'unknown',
          level: liquidity.strongest?.level,
          inducement: inducement.present,
        },
        sweep: sweep.lastSweep,
        displacement: {
          type: displacement.type,
          strength: displacement.strength,
          quality: displacement.quality,
        },
        confirmation: confirmation.strongestSignal,
        zones: direction === 'BUY' ? zones.nearestDemand : zones.nearestSupply,
        entryModel: entryModel.type,
      },

      // Risk info
      risk: {
        maxDailyTrades: this.riskEngine.config.maxTradesPerDay,
        remainingTrades: this.riskEngine.getStats().remainingTrades,
        riskPerTrade: this.riskEngine.config.riskPerTrade,
      },
    };
  }

  /**
   * Determine trade direction
   */
  determineDirection(bias, displacement, confirmation) {
    // Primary: HTF bias
    if (bias.direction === 'bullish') return 'BUY';
    if (bias.direction === 'bearish') return 'SELL';

    // Secondary: Displacement
    if (displacement.bullish) return 'BUY';
    if (displacement.bearish) return 'SELL';

    // Fallback: Confirmation
    if (confirmation.bullish) return 'BUY';
    if (confirmation.bearish) return 'SELL';

    return 'NONE';
  }

  /**
   * Calculate entry and SL levels
   */
  calculateLevels(direction, currentPrice, liquidity, zones, sweep) {
    let entry = currentPrice;
    let sl;

    // SL at sweep extreme
    if (sweep.lastSweep) {
      if (direction === 'BUY') {
        sl = sweep.lastSweep.wickLow || zones.nearestDemand?.low;
      } else {
        sl = sweep.lastSweep.wickHigh || zones.nearestSupply?.high;
      }
    }

    // Fallback: use zones
    if (!sl) {
      sl = direction === 'BUY' 
        ? (zones.nearestDemand?.low || currentPrice * 0.995)
        : (zones.nearestSupply?.high || currentPrice * 1.005);
    }

    // Round
    const decimals = this.getDecimals(currentPrice);
    entry = parseFloat(entry.toFixed(decimals));
    sl = parseFloat(sl.toFixed(decimals));

    return { entry, sl };
  }

  /**
   * Calculate multiple targets
   */
  calculateTargets(direction, entry, liquidity, bias) {
    const sl = direction === 'BUY' ? entry * 0.995 : entry * 1.005; // Approximate
    const risk = Math.abs(entry - sl);

    // TP1: Internal liquidity (2:1)
    const tp1 = direction === 'BUY' ? entry + risk * 2 : entry - risk * 2;

    // TP2: External liquidity (3:1)
    const tp2 = direction === 'BUY' 
      ? (liquidity.nextTarget?.nextHigh || entry + risk * 3)
      : (liquidity.nextTarget?.nextLow || entry - risk * 3);

    // TP3: HTF level (4:1)
    const tp3 = direction === 'BUY'
      ? (bias.liquidityTargets?.nextHigh || entry + risk * 4)
      : (bias.liquidityTargets?.nextLow || entry - risk * 4);

    const decimals = this.getDecimals(entry);

    return {
      tp1: parseFloat(tp1.toFixed(decimals)),
      tp2: parseFloat(tp2.toFixed(decimals)),
      tp3: parseFloat(tp3.toFixed(decimals)),
      riskReward: (Math.abs(tp1 - entry) / risk).toFixed(1),
    };
  }

  /**
   * Build human-readable reasons
   */
  buildReasons(data) {
    const { bias, liquidity, inducement, sweep, displacement, confirmation } = data;
    const detailed = [];

    // Primary reason
    let primary = `${bias.direction.toUpperCase()} HTF bias (${bias.score}%) + ${bias.zonePosition} zone`;

    // Add components
    if (sweep.lastSweep) {
      detailed.push(`✓ Liquidity sweep detected`);
    }

    if (displacement.bullish || displacement.bearish) {
      detailed.push(`✓ Strong displacement (${displacement.quality}%)`);
    }

    if (inducement.present) {
      detailed.push(`✓ Inducement cleared`);
    }

    if (confirmation.strongestSignal) {
      detailed.push(`✓ ${confirmation.strongestSignal.type.replace(/_/g, ' ')}`);
    }

    if (liquidity.strongest) {
      detailed.push(`✓ ${liquidity.strongest.type} liquidity`);
    }

    return { primary, detailed };
  }

  /**
   * Detect inducement (fake move before real move)
   */
  detectInducement(candles, liquidity) {
    // Use liquidity engine's inducement detection
    const hasInducement = liquidity.inducement.buySide.length > 0 || 
                          liquidity.inducement.sellSide.length > 0;

    const inducementData = hasInducement
      ? (liquidity.inducement.buySide[0] || liquidity.inducement.sellSide[0])
      : null;

    return {
      present: hasInducement,
      type: inducementData?.type || null,
      level: inducementData?.level || null,
      strength: inducementData?.strength || 0,
    };
  }

  /**
   * Validate sweep is near a zone
   */
  validateSweep(sweep, zones, currentPrice) {
    if (!sweep || !sweep.lastSweep) {
      return { valid: false, reason: 'No sweep detected' };
    }

    // Check sweep is near a supply/demand zone
    const relevantZone = sweep.lastSweep.direction === 'bullish' 
      ? zones.nearestDemand 
      : zones.nearestSupply;

    if (!relevantZone) {
      return { valid: false, reason: 'Sweep not near valid zone' };
    }

    // Check sweep quality
    if (sweep.lastSweep.strength < 40) {
      return { valid: false, reason: 'Sweep quality too low' };
    }

    return { valid: true, zone: relevantZone };
  }

  /**
   * Get grade based on confidence
   */
  getGrade(confidence) {
    if (confidence >= 95) return 'S';
    if (confidence >= 90) return 'A+';
    if (confidence >= 85) return 'A';
    if (confidence >= 80) return 'B+';
    if (confidence >= 70) return 'B';
    return 'C';
  }

  /**
   * Create reject result for debugging
   */
  createRejectResult(layer, reason, data) {
    return {
      valid: false,
      rejectedAt: layer,
      reason,
      ...data,
    };
  }

  /**
   * Create HTF candles from LTF
   */
  createHTFCandles(candles, factor) {
    const htf = [];
    for (let i = 0; i < candles.length; i += factor) {
      const chunk = candles.slice(i, i + factor);
      if (chunk.length === 0) continue;

      htf.push({
        open: chunk[0].open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((sum, c) => sum + (c.volume || 0), 0),
      });
    }
    return htf;
  }

  /**
   * Get decimal places
   */
  getDecimals(price) {
    if (price > 1000) return 2;
    if (price > 100) return 3;
    if (price > 1) return 5;
    return 7;
  }

  /**
   * Get risk stats
   */
  getRiskStats() {
    return this.riskEngine.getStats();
  }

  /**
   * Record trade result
   */
  recordTrade(trade) {
    this.riskEngine.recordTrade(trade);
  }
}
