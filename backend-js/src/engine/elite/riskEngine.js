/**
 * Risk Engine - ELITE VERSION
 * Professional risk management with daily limits, streak control, and position sizing
 * 
 * Rules:
 * - Risk per trade: 1%
 * - Max trades per day: 3
 * - If 2 losses → Stop trading
 * - Daily loss limit: 3%
 */

import { logger } from "../../services/logger.js";

export class EliteRiskEngine {
  constructor(config = {}) {
    this.config = {
      riskPerTrade: config.riskPerTrade || 0.01, // 1%
      maxTradesPerDay: config.maxTradesPerDay || 3,
      maxDailyLoss: config.maxDailyLoss || 0.03, // 3%
      stopAfterLosses: config.stopAfterLosses || 2,
      ...config,
    };

    // State tracking
    this.state = {
      dailyTrades: [],
      dailyLosses: 0,
      dailyWins: 0,
      dailyPnL: 0,
      lastReset: new Date().toDateString(),
      canTrade: true,
      stopReason: null,
    };

    this.loadState();
  }

  /**
   * Check if trading is allowed
   * @returns {Object} Trading permission status
   */
  canTrade() {
    this.checkDailyReset();

    if (!this.state.canTrade) {
      return {
        allowed: false,
        reason: this.state.stopReason,
        advice: 'Stop trading for today',
      };
    }

    // Check trade count
    if (this.state.dailyTrades.length >= this.config.maxTradesPerDay) {
      return {
        allowed: false,
        reason: `Max trades reached (${this.config.maxTradesPerDay})`,
        advice: 'Daily trade limit reached',
      };
    }

    // Check consecutive losses
    if (this.state.dailyLosses >= this.config.stopAfterLosses) {
      this.state.canTrade = false;
      this.state.stopReason = `${this.config.stopAfterLosses} consecutive losses`;
      this.saveState();
      
      return {
        allowed: false,
        reason: this.state.stopReason,
        advice: 'Take a break. Review your strategy.',
      };
    }

    // Check daily loss limit
    if (this.state.dailyPnL <= -this.config.maxDailyLoss) {
      this.state.canTrade = false;
      this.state.stopReason = `Daily loss limit hit (${(this.config.maxDailyLoss * 100).toFixed(0)}%)`;
      this.saveState();

      return {
        allowed: false,
        reason: this.state.stopReason,
        advice: 'Protect your capital. Stop for today.',
      };
    }

    return {
      allowed: true,
      remainingTrades: this.config.maxTradesPerDay - this.state.dailyTrades.length,
      dailyPnL: this.state.dailyPnL,
      dailyLosses: this.state.dailyLosses,
      riskPerTrade: this.config.riskPerTrade,
    };
  }

  /**
   * Calculate position size
   * @param {number} accountBalance - Current account balance
   * @param {number} stopLossPips - Stop loss in pips
   * @param {number} pipValue - Value per pip
   * @returns {Object} Position sizing details
   */
  calculatePositionSize(accountBalance, stopLossPips, pipValue) {
    // Calculate risk amount
    const riskAmount = accountBalance * this.config.riskPerTrade;
    
    // Calculate position size
    const positionSize = riskAmount / (stopLossPips * pipValue);
    
    // Round to standard lot sizes
    const lots = Math.floor(positionSize * 100) / 100;
    
    // Verify
    const actualRisk = lots * stopLossPips * pipValue;
    const actualRiskPercent = (actualRisk / accountBalance) * 100;

    return {
      lots,
      units: lots * 100000, // Standard forex lot
      riskAmount: actualRisk,
      riskPercent: actualRiskPercent,
      stopLossPips,
      isValid: actualRiskPercent <= this.config.riskPerTrade * 1.1, // Allow 10% variance
    };
  }

  /**
   * Record a trade result
   * @param {Object} trade - Trade result
   */
  recordTrade(trade) {
    this.checkDailyReset();

    this.state.dailyTrades.push({
      ...trade,
      timestamp: new Date().toISOString(),
    });

    // Update PnL
    const pnl = trade.pnl || 0;
    this.state.dailyPnL += pnl;

    // Update win/loss
    if (pnl > 0) {
      this.state.dailyWins++;
      this.state.dailyLosses = 0; // Reset loss streak on win
    } else if (pnl < 0) {
      this.state.dailyLosses++;
    }

    this.saveState();

    logger.info(`Trade recorded: ${trade.pair} ${trade.type} PnL: ${pnl.toFixed(2)}`);
  }

  /**
   * Validate signal against risk rules
   * @param {Object} signal - Trading signal
   * @returns {Object} Validation result
   */
  validateSignal(signal) {
    const permission = this.canTrade();

    if (!permission.allowed) {
      return {
        valid: false,
        reason: permission.reason,
        advice: permission.advice,
      };
    }

    // Check minimum R:R
    if (!signal.riskReward || signal.riskReward < 1.5) {
      return {
        valid: false,
        reason: 'Insufficient Risk:Reward ratio',
        advice: 'Wait for better R:R (minimum 1.5:1)',
      };
    }

    // Check stop loss is defined
    if (!signal.stopLoss || signal.stopLoss <= 0) {
      return {
        valid: false,
        reason: 'No stop loss defined',
        advice: 'Always use stop loss',
      };
    }

    // Check confidence
    if (signal.confidence < 70) {
      return {
        valid: false,
        reason: 'Confidence too low',
        advice: 'Wait for higher confidence setup',
      };
    }

    return {
      valid: true,
      reason: 'Signal passes risk checks',
      riskPerTrade: this.config.riskPerTrade,
      remainingTrades: permission.remainingTrades,
    };
  }

  /**
   * Get current stats
   */
  getStats() {
    this.checkDailyReset();

    const trades = this.state.dailyTrades;
    const winRate = trades.length > 0 
      ? (this.state.dailyWins / trades.length) * 100 
      : 0;

    return {
      tradesToday: trades.length,
      wins: this.state.dailyWins,
      losses: this.state.dailyLosses,
      winRate: winRate.toFixed(1),
      dailyPnL: this.state.dailyPnL,
      dailyPnLPercent: (this.state.dailyPnL * 100).toFixed(2),
      canTrade: this.state.canTrade,
      stopReason: this.state.stopReason,
      remainingTrades: this.config.maxTradesPerDay - trades.length,
      maxTrades: this.config.maxTradesPerDay,
      riskPerTrade: this.config.riskPerTrade,
    };
  }

  /**
   * Reset daily stats (new day)
   */
  checkDailyReset() {
    const today = new Date().toDateString();
    
    if (this.state.lastReset !== today) {
      this.state = {
        dailyTrades: [],
        dailyLosses: 0,
        dailyWins: 0,
        dailyPnL: 0,
        lastReset: today,
        canTrade: true,
        stopReason: null,
      };
      this.saveState();
      
      logger.info('Daily risk stats reset for new day');
    }
  }

  /**
   * Manual reset (for testing)
   */
  manualReset() {
    this.state = {
      dailyTrades: [],
      dailyLosses: 0,
      dailyWins: 0,
      dailyPnL: 0,
      lastReset: new Date().toDateString(),
      canTrade: true,
      stopReason: null,
    };
    this.saveState();
  }

  /**
   * Save state to persistence
   */
  saveState() {
    // In production, save to database or file
    // For now, keep in memory
    this._persistedState = JSON.stringify(this.state);
  }

  /**
   * Load state from persistence
   */
  loadState() {
    // In production, load from database or file
    // For now, start fresh
    this.saveState();
  }

  /**
   * Get risk warnings and advice
   */
  getRiskAdvice() {
    const stats = this.getStats();
    const advice = [];

    if (stats.losses === 1) {
      advice.push('⚠️ 1 loss today. Be extra careful on next trade.');
    }

    if (stats.dailyPnL < -0.01) {
      advice.push('📉 Down 1% today. Consider stopping if next trade loses.');
    }

    if (stats.tradesToday === 2 && stats.winRate === '0.0') {
      advice.push('💀 0/2 today. Next trade MUST be A+ setup or skip.');
    }

    if (stats.winRate > '66.0') {
      advice.push('🔥 Hot streak! Maintain discipline.');
    }

    return advice;
  }

  /**
   * Calculate Kelly Criterion for position sizing (advanced)
   */
  calculateKelly(winRate, avgWin, avgLoss) {
    // Kelly % = W - [(1 - W) / R]
    // W = win rate, R = win/loss ratio
    
    if (winRate <= 0 || avgLoss <= 0) return 0;
    
    const r = avgWin / avgLoss;
    const kelly = winRate - ((1 - winRate) / r);
    
    // Use half-Kelly for safety
    return Math.max(0, kelly * 0.5);
  }
}
