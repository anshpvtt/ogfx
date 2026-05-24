/**
 * Context Filter Engine - Smart Money Concepts
 * Filters out low-quality trade setups
 * Applies session, volatility, spread, and timing filters
 */

import { logger } from "../../services/logger.js";

export class ContextFilter {
  constructor(config = {}) {
    this.config = {
      // Session settings
      requireFavorableSession: config.requireFavorableSession ?? true,
      preferredSessions: config.preferredSessions || ["London", "NewYork", "LondonNY"],

      // Volatility settings
      minATRPercent: config.minATRPercent || 0.1, // Minimum 0.1% ATR
      maxATRPercent: config.maxATRPercent || 2.0, // Maximum 2% ATR (too volatile)

      // Spread settings
      maxSpreadPercent: config.maxSpreadPercent || 0.05, // 0.05% max spread

      // Cooldown settings
      cooldownMinutes: config.cooldownMinutes || 30, // Minimum time between signals

      // HTF alignment
      requireHTFAlignment: config.requireHTFAlignment ?? true,
      minHTFScore: config.minHTFScore || 60,

      ...config,
    };

    // Track last signals for cooldown
    this.lastSignals = new Map();
  }

  /**
   * Apply all context filters
   * @param {Object} context - Context data including session, volatility, HTF, etc.
   * @param {string} symbol - Trading symbol
   * @returns {Object} Filter result
   */
  validate(context, symbol) {
    const checks = [];
    let passed = 0;
    let total = 0;

    // Session check
    total++;
    const sessionCheck = this.checkSession(context.session);
    checks.push(sessionCheck);
    if (sessionCheck.passed) passed++;

    // Volatility check
    total++;
    const volatilityCheck = this.checkVolatility(context.volatility);
    checks.push(volatilityCheck);
    if (volatilityCheck.passed) passed++;

    // HTF alignment check
    total++;
    const htfCheck = this.checkHTFAlignment(context.htf);
    checks.push(htfCheck);
    if (htfCheck.passed) passed++;

    // Spread check
    total++;
    const spreadCheck = this.checkSpread(context.spread);
    checks.push(spreadCheck);
    if (spreadCheck.passed) passed++;

    // Cooldown check
    total++;
    const cooldownCheck = this.checkCooldown(symbol);
    checks.push(cooldownCheck);
    if (cooldownCheck.passed) passed++;

    // Market condition check
    total++;
    const marketCheck = this.checkMarketConditions(context);
    checks.push(marketCheck);
    if (marketCheck.passed) passed++;

    const allPassed = passed === total;
    const canProceed = !this.config.requireFavorableSession || allPassed;

    return {
      valid: canProceed,
      passed,
      total,
      allPassed,
      checks,
      score: Math.round((passed / total) * 100),
      warnings: checks.filter((c) => !c.passed).map((c) => c.message),
      advice: this.getTradingAdvice(checks),
    };
  }

  /**
   * Check trading session
   */
  checkSession(session) {
    if (!session) {
      return {
        name: "Session",
        passed: false,
        message: "Session data unavailable",
        critical: true,
      };
    }

    const isFavorable = session.favorable;
    const isOptimal = session.optimal;

    if (isOptimal) {
      return {
        name: "Session",
        passed: true,
        message: `Optimal session: ${session.session} overlap`,
        bonus: 15,
        critical: false,
      };
    }

    if (isFavorable) {
      return {
        name: "Session",
        passed: true,
        message: `Favorable session: ${session.session}`,
        bonus: 10,
        critical: false,
      };
    }

    return {
      name: "Session",
      passed: false,
      message: `Unfavorable session: ${session.session}. Consider waiting for London/NY.`,
      penalty: -15,
      critical: this.config.requireFavorableSession,
    };
  }

  /**
   * Check volatility (ATR)
   */
  checkVolatility(volatility) {
    if (!volatility || volatility.normalized === undefined) {
      return {
        name: "Volatility",
        passed: true,
        message: "Volatility data unavailable - proceeding with caution",
        warning: true,
      };
    }

    const atrPercent = volatility.normalized;

    // Too low (Asian session, dead market)
    if (atrPercent < this.config.minATRPercent) {
      return {
        name: "Volatility",
        passed: false,
        message: `Volatility too low: ${atrPercent.toFixed(3)}%. Minimum: ${this.config.minATRPercent}%`,
        penalty: -20,
        critical: true,
      };
    }

    // Too high (news event, unstable)
    if (atrPercent > this.config.maxATRPercent) {
      return {
        name: "Volatility",
        passed: false,
        message: `Volatility too high: ${atrPercent.toFixed(2)}%. Maximum: ${this.config.maxATRPercent}%`,
        penalty: -25,
        critical: true,
      };
    }

    // Good volatility range
    const isGood = atrPercent >= 0.3 && atrPercent <= 1.0;

    return {
      name: "Volatility",
      passed: true,
      message: `Volatility OK: ${atrPercent.toFixed(3)}%`,
      bonus: isGood ? 10 : 0,
    };
  }

  /**
   * Check HTF alignment
   */
  checkHTFAlignment(htf) {
    if (!htf) {
      return {
        name: "HTF Alignment",
        passed: true,
        message: "HTF data unavailable",
        warning: true,
      };
    }

    if (this.config.requireHTFAlignment) {
      if (htf.score < this.config.minHTFScore) {
        return {
          name: "HTF Alignment",
          passed: false,
          message: `HTF score too low: ${htf.score}/${this.config.minHTFScore}`,
          penalty: -30,
          critical: true,
        };
      }

      if (htf.bias === "neutral") {
        return {
          name: "HTF Alignment",
          passed: false,
          message: "HTF bias neutral - no clear direction",
          penalty: -15,
          critical: false,
        };
      }
    }

    return {
      name: "HTF Alignment",
      passed: true,
      message: `HTF aligned: ${htf.bias} (${htf.score}%)`,
      bonus: Math.round(htf.score * 0.3), // Up to 30 points
    };
  }

  /**
   * Check spread
   */
  checkSpread(spread) {
    if (!spread || !spread.percent) {
      return {
        name: "Spread",
        passed: true,
        message: "Spread data unavailable",
        warning: true,
      };
    }

    if (spread.percent > this.config.maxSpreadPercent) {
      return {
        name: "Spread",
        passed: false,
        message: `Spread too high: ${spread.percent.toFixed(3)}% > ${this.config.maxSpreadPercent}%`,
        penalty: -10,
        critical: false,
      };
    }

    return {
      name: "Spread",
      passed: true,
      message: `Spread OK: ${spread.percent.toFixed(4)}%`,
    };
  }

  /**
   * Check cooldown period
   */
  checkCooldown(symbol) {
    const lastSignal = this.lastSignals.get(symbol);

    if (!lastSignal) {
      return {
        name: "Cooldown",
        passed: true,
        message: "No recent signals",
      };
    }

    const now = Date.now();
    const minutesSince = (now - lastSignal) / (60 * 1000);

    if (minutesSince < this.config.cooldownMinutes) {
      return {
        name: "Cooldown",
        passed: false,
        message: `Cooldown active: ${Math.round(this.config.cooldownMinutes - minutesSince)} min remaining`,
        penalty: -20,
        critical: true,
      };
    }

    return {
      name: "Cooldown",
      passed: true,
      message: `Cooldown clear: ${Math.round(minutesSince)} min since last signal`,
    };
  }

  /**
   * Check overall market conditions
   */
  checkMarketConditions(context) {
    const warnings = [];

    // Check for news events
    if (context.highImpactNews) {
      warnings.push("High impact news approaching");
    }

    // Check for weekend
    const now = new Date();
    const day = now.getUTCDay();
    if (day === 0 || day === 6) {
      return {
        name: "Market Conditions",
        passed: false,
        message: "Weekend - markets closed or low liquidity",
        penalty: -50,
        critical: true,
      };
    }

    // Check for gaps
    if (context.recentGap) {
      warnings.push("Recent price gap detected");
    }

    if (warnings.length > 0) {
      return {
        name: "Market Conditions",
        passed: false,
        message: warnings.join(", "),
        penalty: -10 * warnings.length,
        critical: false,
      };
    }

    return {
      name: "Market Conditions",
      passed: true,
      message: "Market conditions favorable",
    };
  }

  /**
   * Get trading advice based on filter results
   */
  getTradingAdvice(checks) {
    const failed = checks.filter((c) => !c.passed);

    if (failed.length === 0) {
      return {
        action: "proceed",
        message: "All context filters passed. High-quality setup.",
      };
    }

    const critical = failed.filter((c) => c.critical);

    if (critical.length > 0) {
      return {
        action: "reject",
        message: `Critical filters failed: ${critical.map((c) => c.name).join(", ")}. Avoid this trade.`,
      };
    }

    return {
      action: "caution",
      message: `Some filters failed: ${failed.map((c) => c.name).join(", ")}. Consider reduced position size.`,
    };
  }

  /**
   * Record signal for cooldown tracking
   */
  recordSignal(symbol) {
    this.lastSignals.set(symbol, Date.now());
  }

  /**
   * Clear old cooldowns
   */
  clearOldCooldowns() {
    const now = Date.now();
    const maxAge = this.config.cooldownMinutes * 2 * 60 * 1000; // 2x cooldown

    for (const [symbol, timestamp] of this.lastSignals.entries()) {
      if (now - timestamp > maxAge) {
        this.lastSignals.delete(symbol);
      }
    }
  }
}
