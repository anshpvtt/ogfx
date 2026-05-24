/**
 * PDF Strategy Parser
 * Converts trading strategy PDFs to structured JSON rules
 */

import fs from "fs/promises";
import pdfParse from "pdf-parse";
import { logger } from "../backend-js/src/services/logger.js";

export class PDFStrategyParser {
  constructor() {
    this.defaultTemplate = {
      name: "Parsed Strategy",
      version: "1.0.0",
      description: "",
      timeframe: "15m",
      rules: {
        BUY: {},
        SELL: {},
      },
      context: {
        minConfidence: 60,
      },
      riskManagement: {
        slMultiplier: 2.0,
        tpMultiplier: 3.0,
      },
    };
  }

  /**
   * Parse PDF file to strategy JSON
   * @param {string} filePath - Path to PDF file
   * @returns {Object} - Parsed strategy configuration
   */
  async parseFile(filePath) {
    try {
      const dataBuffer = await fs.readFile(filePath);
      return await this.parseBuffer(dataBuffer);
    } catch (error) {
      logger.error("Error reading PDF file:", error);
      throw error;
    }
  }

  /**
   * Parse PDF buffer to strategy JSON
   * @param {Buffer} buffer - PDF data buffer
   * @returns {Object} - Parsed strategy configuration
   */
  async parseBuffer(buffer) {
    try {
      const pdfData = await pdfParse(buffer);
      const text = pdfData.text;

      logger.info(`Parsed PDF with ${pdfData.numpages} pages`);

      // Extract strategy configuration from text
      const strategy = this.extractStrategy(text);

      return strategy;
    } catch (error) {
      logger.error("Error parsing PDF:", error);
      throw error;
    }
  }

  /**
   * Extract strategy rules from text
   * @param {string} text - Extracted PDF text
   * @returns {Object} - Strategy configuration
   */
  extractStrategy(text) {
    const strategy = JSON.parse(JSON.stringify(this.defaultTemplate));

    // Try to extract timeframe
    const timeframeMatch = text.match(/timeframe[:\s]+(\d+[mhd])/i);
    if (timeframeMatch) {
      strategy.timeframe = timeframeMatch[1];
    }

    // Extract indicators
    const hasRSI = /RSI/i.test(text);
    const hasEMA = /EMA/i.test(text);
    const hasATR = /ATR/i.test(text);
    const hasBreakout = /breakout/i.test(text);

    // Build BUY rules
    if (hasBreakout) {
      strategy.rules.BUY.breakout = {
        enabled: true,
        lookback: 20,
        threshold: 0.95,
      };
    }

    if (hasRSI) {
      const rsiPeriod = this.extractNumber(text, /RSI[\s\(]*(\d+)[\s\)]*/i) || 14;
      const rsiOversold = this.extractNumber(text, /oversold[:\s]+(\d+)/i) || 30;
      const rsiOverbought = this.extractNumber(text, /overbought[:\s]+(\d+)/i) || 70;

      strategy.rules.BUY.rsi = {
        enabled: true,
        period: rsiPeriod,
        oversold: rsiOversold + 5, // Slightly higher for buy
        overbought: rsiOverbought,
      };

      strategy.rules.SELL.rsi = {
        enabled: true,
        period: rsiPeriod,
        oversold: rsiOversold,
        overbought: rsiOverbought - 5, // Slightly lower for sell
      };
    }

    if (hasEMA) {
      const emaMatch = text.match(/EMA[\s\(]*(\d+)[,\s]+(\d+)[\s\)]*/i);
      const fastEma = emaMatch ? parseInt(emaMatch[1]) : 20;
      const slowEma = emaMatch ? parseInt(emaMatch[2]) : 50;

      strategy.rules.BUY.trend = {
        enabled: true,
        fastEma,
        slowEma,
      };

      strategy.rules.SELL.trend = {
        enabled: true,
        fastEma,
        slowEma,
      };
    }

    // Copy BUY rules to SELL with modifications
    if (hasBreakout) {
      strategy.rules.SELL.breakout = {
        enabled: true,
        lookback: 20,
        threshold: 0.95,
      };
    }

    // Extract risk management
    const slMatch = text.match(/stop[\s-]?loss[\s]*[:\s]*(\d+(?:\.\d+)?)/i);
    if (slMatch) {
      strategy.riskManagement.slMultiplier = parseFloat(slMatch[1]);
    }

    const tpMatch = text.match(/take[\s-]?profit[\s]*[:\s]*(\d+(?:\.\d+)?)/i);
    if (tpMatch) {
      strategy.riskManagement.tpMultiplier = parseFloat(tpMatch[1]);
    }

    // Extract min confidence
    const confidenceMatch = text.match(/confidence[\s]*[:\s]*(\d+)/i);
    if (confidenceMatch) {
      strategy.context.minConfidence = parseInt(confidenceMatch[1]);
    }

    // Generate description
    const indicators = [];
    if (hasRSI) indicators.push("RSI");
    if (hasEMA) indicators.push("EMA");
    if (hasATR) indicators.push("ATR");
    if (hasBreakout) indicators.push("Breakout");

    strategy.description = `Rule-based strategy using ${indicators.join(", ") || "technical analysis"}`;

    return strategy;
  }

  extractNumber(text, regex) {
    const match = text.match(regex);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * Validate strategy configuration
   * @param {Object} strategy - Strategy object
   * @returns {Object} - Validation result
   */
  validate(strategy) {
    const errors = [];

    if (!strategy.name) errors.push("Strategy name is required");
    if (!strategy.timeframe) errors.push("Timeframe is required");
    if (!strategy.rules?.BUY && !strategy.rules?.SELL) {
      errors.push("At least one set of rules (BUY or SELL) is required");
    }

    const isValid = errors.length === 0;

    return {
      isValid,
      errors,
      warnings: isValid ? this.getWarnings(strategy) : [],
    };
  }

  getWarnings(strategy) {
    const warnings = [];

    if (!strategy.rules?.BUY?.breakout && !strategy.rules?.BUY?.rsi && !strategy.rules?.BUY?.trend) {
      warnings.push("No specific rules detected for BUY signals");
    }

    if (!strategy.context?.minConfidence || strategy.context.minConfidence < 50) {
      warnings.push("Low confidence threshold may produce too many signals");
    }

    return warnings;
  }

  /**
   * Convert strategy to JSON string
   * @param {Object} strategy - Strategy object
   * @param {boolean} pretty - Pretty print
   * @returns {string} - JSON string
   */
  toJSON(strategy, pretty = true) {
    return JSON.stringify(strategy, null, pretty ? 2 : 0);
  }
}
