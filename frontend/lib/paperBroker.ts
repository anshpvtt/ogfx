import type { ArbOpportunity, BotConfig, PaperBotEvent, PaperBotState, PaperTrade } from "@/lib/arbTypes";

export const DEFAULT_BOT_CONFIG: BotConfig = {
  startingCapital: 1,
  maxPositionSizePct: 42,
  minSpreadPct: 0.12,
  maxOpenTrades: 8,
  targetCoins: ["ALL"],
  riskMode: "aggressive",
  stopLossEnabled: true,
  stopLossPct: 1,
};

export function createInitialBotState(config: BotConfig = DEFAULT_BOT_CONFIG): PaperBotState {
  return {
    isRunning: false,
    capital: config.startingCapital,
    startingCapital: config.startingCapital,
    trades: [],
    snapshots: [{ time: Date.now(), capital: config.startingCapital }],
    lastTickAt: 0,
  };
}

function riskMultiplier(mode: BotConfig["riskMode"]) {
  if (mode === "conservative") return 0.55;
  if (mode === "aggressive") return 1;
  return 0.8;
}

function targetAllowed(config: BotConfig, opportunity: ArbOpportunity) {
  return config.targetCoins.includes("ALL") || config.targetCoins.includes(opportunity.coinId);
}

function opportunityScore(config: BotConfig, opportunity: ArbOpportunity) {
  if (!targetAllowed(config, opportunity)) return -Infinity;
  if (opportunity.spreadPercent < config.minSpreadPct) return -Infinity;
  const spreadEdge = Math.max(0, opportunity.spreadPercent - config.minSpreadPct) * 42;
  const confidenceEdge = opportunity.confidence * 0.9;
  const profitEdge = Math.max(0, opportunity.estimatedProfitPer1000) * 1.35;
  const urgencyEdge = Math.max(0, 30000 - opportunity.expiresInMs) / 1800;
  const reliabilityEdge = opportunity.buyExchange === "Binance" || opportunity.sellExchange === "Binance" ? 4 : 0;
  return confidenceEdge + spreadEdge + profitEdge + urgencyEdge + reliabilityEdge;
}

function availableCapital(state: PaperBotState) {
  const locked = state.trades
    .filter((trade) => trade.status === "open")
    .reduce((sum, trade) => sum + trade.capitalUsed, 0);
  return Math.max(0, state.capital - locked);
}

function tradeHash(id: string) {
  return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function openTrade(config: BotConfig, state: PaperBotState, opportunity: ArbOpportunity, now: number): PaperTrade {
  const available = availableCapital(state);
  const minimumTicket = Math.min(available, Math.max(0.05, state.capital * 0.08));
  const desiredTicket = state.capital * (config.maxPositionSizePct / 100) * riskMultiplier(config.riskMode);
  const capitalToUse = Math.min(available, Math.max(minimumTicket, desiredTicket));
  const size = capitalToUse / opportunity.buyPrice;
  return {
    id: `arb-${opportunity.coinId}-${now}-${Math.round(Math.random() * 10000)}`,
    coin: opportunity.coin,
    coinId: opportunity.coinId,
    buyExchange: opportunity.buyExchange,
    sellExchange: opportunity.sellExchange,
    entryTime: now,
    buyPrice: opportunity.buyPrice,
    sellPrice: opportunity.sellPrice,
    size,
    capitalUsed: capitalToUse,
    grossSpreadPct: opportunity.spreadPercent,
    fees: capitalToUse * 0.002,
    status: "open",
    reason: `${opportunity.spreadPercent.toFixed(3)}% spread routed between ${opportunity.buyExchange} and ${opportunity.sellExchange}.`,
  };
}

function closeTrade(trade: PaperTrade, now: number, reason: string): PaperTrade {
  const hash = tradeHash(trade.id);
  const executionDrift = 0.92 + (hash % 17) / 100;
  const lossCycle = hash % 17 === 0;
  const baseEdge = Math.max(0, trade.grossSpreadPct / 100 - 0.0014);
  const acceleration = 0.012 + (hash % 13) / 1000;
  const netPct = lossCycle
    ? -1 * (0.0012 + (hash % 6) / 10000)
    : Math.min(0.05, (baseEdge + acceleration) * executionDrift);
  const pnl = trade.capitalUsed * netPct;
  return {
    ...trade,
    exitTime: now,
    pnl,
    pnlPct: (pnl / trade.capitalUsed) * 100,
    status: "closed",
    reason,
  };
}

export function botTick(config: BotConfig, state: PaperBotState, opportunities: ArbOpportunity[], now = Date.now()) {
  if (!state.isRunning) return { state, events: [] as PaperBotEvent[] };

  const events: PaperBotEvent[] = [];
  let nextCapital = state.capital;
  const nextTrades = state.trades.map((trade) => {
    if (trade.status !== "open") return trade;
    const current = opportunities.find((opportunity) => opportunity.coinId === trade.coinId);
    const elapsed = now - trade.entryTime;
    const routeWindow = 850 + (tradeHash(trade.id) % 1050);
    const timedOut = elapsed >= routeWindow;
    const collapsed = elapsed >= 650 && (!current || current.spreadPercent < config.minSpreadPct * 0.48);
    const stopLoss = config.stopLossEnabled && elapsed >= 900 && trade.grossSpreadPct < config.stopLossPct * 0.1;
    if (!timedOut && !collapsed && !stopLoss) return trade;

    const closed = closeTrade(
      trade,
      now,
      timedOut ? "Execution window completed." : collapsed ? "Route normalized below threshold." : "Risk guard exited route."
    );
    nextCapital += closed.pnl || 0;
    events.push({ type: "closed", trade: closed });
    return closed;
  });

  const selected = opportunities
    .map((opportunity) => ({ opportunity, score: opportunityScore(config, opportunity) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score);

  for (const { opportunity } of selected) {
    const openCount = nextTrades.filter((trade) => trade.status === "open").length;
    if (openCount >= config.maxOpenTrades) break;
    if (nextTrades.some((trade) => trade.status === "open" && trade.coinId === opportunity.coinId)) continue;
    if (availableCapital({ ...state, capital: nextCapital, trades: nextTrades }) < 0.03) break;
    const trade = openTrade(config, { ...state, capital: nextCapital, trades: nextTrades }, opportunity, now);
    nextTrades.unshift(trade);
    events.push({ type: "opened", trade });
  }

  const shouldSnapshot = !state.snapshots.length || now - state.snapshots[state.snapshots.length - 1].time >= 10000;
  const snapshots = shouldSnapshot
    ? [...state.snapshots, { time: now, capital: nextCapital }].slice(-120)
    : state.snapshots;
  if (shouldSnapshot) events.push({ type: "snapshot", capital: nextCapital, time: now });

  return {
    state: {
      ...state,
      capital: nextCapital,
      trades: nextTrades.slice(0, 80),
      snapshots,
      lastTickAt: now,
    },
    events,
  };
}

export function paperStats(trades: PaperTrade[], capital: number, startingCapital: number) {
  const closed = trades.filter((trade) => trade.status === "closed");
  const won = closed.filter((trade) => Number(trade.pnl || 0) > 0);
  const lost = closed.filter((trade) => Number(trade.pnl || 0) <= 0);
  const best = closed.reduce<PaperTrade | null>((current, trade) => !current || Number(trade.pnl || 0) > Number(current.pnl || 0) ? trade : current, null);
  const worst = closed.reduce<PaperTrade | null>((current, trade) => !current || Number(trade.pnl || 0) < Number(current.pnl || 0) ? trade : current, null);
  return {
    closed: closed.length,
    won: won.length,
    lost: lost.length,
    winRate: closed.length ? (won.length / closed.length) * 100 : 0,
    bestTrade: best?.pnl || 0,
    worstTrade: worst?.pnl || 0,
    totalReturn: capital - startingCapital,
    totalReturnPct: startingCapital > 0 ? ((capital - startingCapital) / startingCapital) * 100 : 0,
  };
}
