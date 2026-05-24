import { runSmcEngine, type Candle, type SmcSignal } from "@/lib/smc-engine";
import type { StrategyCatalogItem } from "@/lib/strategy-catalog";

export type TradeLogItem = {
  index: number;
  date: string;
  type: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  result: "WIN" | "LOSS" | "TIMEOUT";
  pnl: number;
  balance: number;
  rr: number;
};

export type BacktestResult = {
  summary: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    finalBalance: number;
    sharpeRatio: number;
  };
  equityCurve: Array<{ date: string; balance: number }>;
  tradeLog: TradeLogItem[];
};

function simulateTrade(signal: SmcSignal, future: Candle[]) {
  for (let i = 0; i < future.length; i += 1) {
    const candle = future[i];
    if (signal.signal === "BUY") {
      if (candle.low <= signal.stopLoss) return { result: "LOSS" as const, exitIndex: i };
      if (candle.high >= signal.takeProfit) return { result: "WIN" as const, exitIndex: i };
    }
    if (signal.signal === "SELL") {
      if (candle.high >= signal.stopLoss) return { result: "LOSS" as const, exitIndex: i };
      if (candle.low <= signal.takeProfit) return { result: "WIN" as const, exitIndex: i };
    }
  }
  return { result: "TIMEOUT" as const, exitIndex: future.length - 1 };
}

function calculateMaxDrawdown(curve: Array<{ balance: number }>) {
  let peak = curve[0]?.balance ?? 0;
  let maxDrawdown = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.balance);
    const drawdown = peak > 0 ? ((peak - point.balance) / peak) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  return maxDrawdown;
}

function calculateSharpe(returns: number[]) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length;
  const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? mean / std : 0;
}

export function runWalkForwardBacktest({
  candles,
  pair,
  timeframe,
  initialBalance = 10000,
  strategy,
}: {
  candles: Candle[];
  pair: string;
  timeframe: string;
  initialBalance?: number;
  strategy?: Pick<StrategyCatalogItem, "id" | "name" | "riskReward">;
}): BacktestResult {
  let balance = initialBalance;
  const tradeLog: TradeLogItem[] = [];
  const equityCurve: Array<{ date: string; balance: number }> = [{ date: candles[0]?.time ?? new Date(0).toISOString(), balance }];
  const returns: number[] = [];
  const minBars = Math.min(80, Math.max(50, candles.length - 20));

  for (let i = minBars; i < candles.length - 2; i += 1) {
    const analysis = runSmcEngine(candles.slice(0, i + 1), pair, timeframe);
    const signal = analysis.signal;

    if (signal.signal === "NO_SETUP") continue;

    const future = candles.slice(i + 1, Math.min(candles.length, i + 49));
    if (!future.length) break;

    const simulation = simulateTrade(signal, future);
    const riskAmount = balance * 0.01;
    const effectiveRiskReward = Math.max(signal.riskReward, Number(strategy?.riskReward ?? 0));
    const pnl =
      simulation.result === "WIN"
        ? riskAmount * effectiveRiskReward
        : simulation.result === "LOSS"
          ? -riskAmount
          : 0;
    const previousBalance = balance;
    balance = Number((balance + pnl).toFixed(2));
    returns.push(previousBalance > 0 ? pnl / previousBalance : 0);

    tradeLog.push({
      index: i,
      date: candles[i].time,
      type: signal.signal,
      entry: signal.entry,
      sl: signal.stopLoss,
      tp: signal.takeProfit,
      result: simulation.result,
      pnl: Number(pnl.toFixed(2)),
      balance,
      rr: Number(effectiveRiskReward.toFixed(2)),
    });
    equityCurve.push({ date: candles[Math.min(candles.length - 1, i + 1 + simulation.exitIndex)].time, balance });

    i += simulation.exitIndex + 1;
  }

  const wins = tradeLog.filter((trade) => trade.result === "WIN");
  const losses = tradeLog.filter((trade) => trade.result === "LOSS");
  const grossProfit = wins.reduce((sum, trade) => sum + Math.max(0, trade.pnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + Math.min(0, trade.pnl), 0));

  return {
    summary: {
      totalTrades: tradeLog.length,
      winRate: tradeLog.length ? Number(((wins.length / tradeLog.length) * 100).toFixed(2)) : 0,
      profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 999 : 0,
      maxDrawdown: Number(calculateMaxDrawdown(equityCurve).toFixed(2)),
      finalBalance: balance,
      sharpeRatio: Number(calculateSharpe(returns).toFixed(2)),
    },
    equityCurve,
    tradeLog,
  };
}
