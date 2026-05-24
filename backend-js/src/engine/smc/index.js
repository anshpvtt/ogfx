/**
 * Smart Money Concepts (SMC) Engine Index
 * Exports all SMC components for institutional-grade trading signals
 */

export { MarketStructureEngine } from "./marketStructure.js";
export { LiquidityEngine } from "./liquidityEngine.js";
export { SweepDetector } from "./sweepDetector.js";
export { ConfirmationEngine } from "./confirmationEngine.js";
export { HTFAlignmentEngine } from "./htfAlignment.js";
export { ZoneDetector } from "./zoneDetector.js";
export { ContextFilter } from "./contextFilter.js";
export { SMCSignalEngine } from "./smcSignalEngine.js";

// Default SMC strategy configuration
export const defaultSMCConfig = {
  minConfidence: 70,
  requireSweep: true,
  requireConfirmation: true,
  requireHTFAlignment: true,
  targetRR: 2.0,

  structure: {
    lookbackPeriod: 20,
    minSwingSize: 0.001,
  },

  liquidity: {
    tolerance: 0.0005,
    lookbackPeriod: 30,
    minTouches: 2,
  },

  sweep: {
    wickThreshold: 0.3,
    closeThreshold: 0.001,
    minSweepDistance: 0.0005,
  },

  confirmation: {
    engulfingThreshold: 1.0,
    displacementThreshold: 0.003,
    minCandleSize: 0.001,
  },

  htf: {
    htfInterval: "1h",
    ltfInterval: "15m",
    minAlignmentScore: 60,
  },

  zones: {
    minDepartureStrength: 2.0,
    maxBaseSize: 5,
    minZoneWidth: 0.0005,
    freshness: 20,
  },

  context: {
    requireFavorableSession: true,
    preferredSessions: ["London", "NewYork", "LondonNY"],
    minATRPercent: 0.1,
    maxATRPercent: 2.0,
    maxSpreadPercent: 0.05,
    cooldownMinutes: 30,
    requireHTFAlignment: true,
    minHTFScore: 60,
  },

  symbols: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD"],
};

// SMC strategy JSON template
export const smcStrategyTemplate = {
  name: "OGFX SMC Strategy",
  version: "2.0.0",
  description: "Smart Money Concepts with Liquidity Sweep detection - Institutional-grade trading signals",
  type: "SMC",
  
  philosophy: {
    core: "Trade the reaction after liquidity sweep, not the breakout",
    principle: "Market moves because of liquidity (not indicators)",
    liquidity: "Institutions collect liquidity (stops) above highs / below lows",
  },

  marketStructure: {
    bullish: ["Higher High (HH)", "Higher Low (HL)"],
    bearish: ["Lower High (LH)", "Lower Low (LL)"],
    ranging: "Equal highs + equal lows",
  },

  entryRules: {
    buy: [
      "Price sweeps below equal lows",
      "Creates wick (30% of candle)",
      "Closes back above level",
      "Bullish confirmation (engulfing/BOS/MSS)",
      "HTF bias is bullish",
    ],
    sell: [
      "Price sweeps above equal highs",
      "Creates wick (30% of candle)",
      "Closes back below level",
      "Bearish confirmation (engulfing/BOS/MSS)",
      "HTF bias is bearish",
    ],
  },

  filters: [
    "Session: London / NY preferred (avoid Asian low volatility)",
    "Volatility: ATR between 0.1% and 2.0%",
    "HTF Alignment: Score >= 60",
    "Spread: < 0.05%",
    "Cooldown: 30min between signals on same pair",
  ],

  riskManagement: {
    stopLoss: "At sweep extreme (wick low/high)",
    takeProfit: "Next liquidity pool or 2:1 RR minimum",
    minRR: 1.5,
    targetRR: 2.0,
    positionSizing: "Risk 1-2% per trade",
  },

  confidenceWeights: {
    sweepQuality: 30,
    confirmation: 20,
    htfAlignment: 20,
    zoneQuality: 15,
    contextFilter: 10,
    structureAlignment: 5,
  },

  telegramFormat: `
🚀 OGFX SMC SIGNAL

PAIR: {{pair}}
TYPE: {{type}}
ENTRY: {{entry}}
SL: {{stopLoss}}
TP: {{takeProfit}}

CONFIDENCE: {{confidence}}%
R:R: {{riskReward}}:1

REASON:
{{reason}}

HTF: {{htfBias}} ({{htfScore}}%)
STRUCTURE: {{structure}}
ZONE: {{zoneType}} (Q:{{zoneQuality}})
  `,
};
