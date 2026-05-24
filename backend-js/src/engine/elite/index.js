/**
 * ELITE Engine Index - Exports all elite trading components
 * Multi-layer filter system for institutional-grade signals
 */

export { HTFBiasEngine } from './htfBiasEngine.js';
export { LiquidityMapEngine } from './liquidityMapEngine.js';
export { DisplacementEngine } from './displacementEngine.js';
export { EliteRiskEngine } from './riskEngine.js';
export { EliteSignalEngine } from './eliteSignalEngine.js';

// Elite configuration
export const eliteConfig = {
  minConfidence: 85, // A+ grade threshold
  requireAllLayers: true,

  htf: {
    htfTimeframe: '1h',
    equilibriumMethod: 'midpoint',
    premiumDiscountThreshold: 0.002,
  },

  liquidity: {
    externalLookback: 50,
    internalLookback: 20,
    inducementLookback: 10,
    tolerance: 0.0005,
  },

  sweep: {
    wickThreshold: 0.3,
    closeThreshold: 0.001,
    minSweepDistance: 0.0005,
  },

  confirmation: {
    engulfingThreshold: 1.0,
    displacementThreshold: 0.003,
  },

  displacement: {
    minBodyPercent: 0.6,
    minMovePercent: 0.3,
    imbalanceThreshold: 0.15,
    volumeMultiplier: 1.5,
  },

  zones: {
    minDepartureStrength: 2.0,
    maxBaseSize: 5,
    minZoneWidth: 0.0005,
  },

  risk: {
    riskPerTrade: 0.01, // 1%
    maxTradesPerDay: 3,
    maxDailyLoss: 0.03, // 3%
    stopAfterLosses: 2,
  },
};

// Elite strategy template
export const eliteStrategyTemplate = {
  name: 'OGFX ELITE - Smart Money System',
  version: '3.0.0',
  description: 'Multi-layer filtered institutional trading system. Only A+ grade trades (85+ confidence) pass all filters.',

  layers: [
    { name: 'HTF BIAS', weight: 20, filter: 'HTF direction + Premium/Discount zone' },
    { name: 'LIQUIDITY MAP', weight: 15, filter: 'External/Internal/Inducement liquidity' },
    { name: 'SWEEP', weight: 15, filter: 'Valid liquidity sweep near zone' },
    { name: 'DISPLACEMENT', weight: 15, filter: 'Institutional entry candle' },
    { name: 'CONFIRMATION', weight: 15, filter: 'Engulfing/BOS/MSS' },
    { name: 'ENTRY MODEL', weight: 10, filter: '5-condition combo' },
    { name: 'RISK', weight: 10, filter: 'Daily limits and position sizing' },
  ],

  entryModel: {
    perfect: '6/6 conditions met - A+ grade',
    good: '4-5/6 conditions met - A grade',
    reject: '<4 conditions - No trade',
  },

  confidenceWeights: {
    htfAlignment: 20,
    zonePosition: 20,
    liquidityClarity: 15,
    inducement: 15,
    sweepQuality: 15,
    displacement: 15,
  },

  grades: {
    S: { min: 95, label: 'Perfect', color: '#FFD700' },
    'A+': { min: 90, label: 'Elite', color: '#00FFFF' },
    A: { min: 85, label: 'Excellent', color: '#00FF00' },
    'B+': { min: 80, label: 'Good', color: '#90EE90' },
    B: { min: 70, label: 'Acceptable', color: '#FFD700' },
    C: { min: 0, label: 'Reject', color: '#FF0000' },
  },

  riskRules: {
    riskPerTrade: '1%',
    maxTradesPerDay: 3,
    maxDailyLoss: '3%',
    stopAfterLosses: 2,
  },

  targets: {
    tp1: 'Internal liquidity (2:1)',
    tp2: 'External liquidity (3:1)',
    tp3: 'HTF level (4:1)',
  },

  telegramFormat: `
🚀 OGFX ELITE SIGNAL [{{grade}}]

PAIR: {{pair}}
TYPE: {{type}}
ENTRY: {{entry}}
SL: {{stopLoss}}
TP1: {{takeProfit}}
TP2: {{takeProfit2}}

CONFIDENCE: {{confidence}}%
R:R: {{riskReward}}:1

MODEL: {{entryModel}}
{{reason}}

📊 ELITE ANALYSIS:
• HTF: {{bias.direction}} {{bias.zonePosition}} ({{bias.score}}%)
• Liquidity: {{liquidity.type}}
• Inducement: {{inducement.present ? "✓ Cleared" : "✗ None"}}
• Sweep: {{sweep.type}}
• Displacement: {{displacement.quality}}%

RISK: {{risk.remainingTrades}} trades left today
⏰ {{timestamp}}
  `,
};
