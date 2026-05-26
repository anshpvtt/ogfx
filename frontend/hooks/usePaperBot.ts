"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArbOpportunity, BotConfig, PaperBotState, PaperTrade } from "@/lib/arbTypes";
import { botTick, createInitialBotState, DEFAULT_BOT_CONFIG, paperStats } from "@/lib/paperBroker";

async function postJson(path: string, body: unknown) {
  try {
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Paper bot state remains local if sync is interrupted.
  }
}

export function usePaperBot(opportunities: ArbOpportunity[]) {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_BOT_CONFIG);
  const [state, setState] = useState<PaperBotState>(() => createInitialBotState(DEFAULT_BOT_CONFIG));

  const start = useCallback((nextConfig: BotConfig = config) => {
    const sanitized = {
      ...nextConfig,
      startingCapital: Math.min(10000, Math.max(1, Number(nextConfig.startingCapital) || 100)),
      maxOpenTrades: Math.min(10, Math.max(1, Number(nextConfig.maxOpenTrades) || 3)),
      minSpreadPct: Math.min(5, Math.max(0.15, Number(nextConfig.minSpreadPct) || 0.2)),
    };
    setConfig(sanitized);
    setState((current) => ({
      ...current,
      isRunning: true,
      capital: current.trades.length ? current.capital : sanitized.startingCapital,
      startingCapital: current.trades.length ? current.startingCapital : sanitized.startingCapital,
      snapshots: current.trades.length ? current.snapshots : [{ time: Date.now(), capital: sanitized.startingCapital }],
    }));
    postJson("/api/arb/bot/start", { config: sanitized });
  }, [config]);

  const stop = useCallback(() => {
    setState((current) => ({ ...current, isRunning: false }));
    postJson("/api/arb/bot/stop", {});
  }, []);

  const paperTrade = useCallback((opportunity: ArbOpportunity) => {
    const singleConfig = { ...config, minSpreadPct: Math.max(0.15, opportunity.spreadPercent - 0.001), maxOpenTrades: config.maxOpenTrades + 1 };
    setState((current) => {
      const { state: next, events } = botTick(singleConfig, { ...current, isRunning: true }, [opportunity], Date.now());
      for (const event of events) {
        if (event.type === "opened") postJson("/api/arb/trade/open", { trade: event.trade });
        if (event.type === "closed") postJson("/api/arb/trade/close", { trade: event.trade });
      }
      return { ...next, isRunning: current.isRunning };
    });
  }, [config]);

  useEffect(() => {
    if (!state.isRunning) return;
    const interval = window.setInterval(() => {
      setState((current) => {
        const { state: next, events } = botTick(config, current, opportunities, Date.now());
        for (const event of events) {
          if (event.type === "opened") postJson("/api/arb/trade/open", { trade: event.trade });
          if (event.type === "closed") postJson("/api/arb/trade/close", { trade: event.trade });
          if (event.type === "snapshot") postJson("/api/arb/capital", { capital: event.capital, snapshotAt: event.time });
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [config, opportunities, state.isRunning]);

  const stats = useMemo(() => paperStats(state.trades, state.capital, state.startingCapital), [state]);
  const openTrades = state.trades.filter((trade) => trade.status === "open");
  const closedTrades = state.trades.filter((trade) => trade.status === "closed");

  function hydrateHistory(trades: PaperTrade[]) {
    setState((current) => {
      if (current.trades.length) return current;
      const closed = trades.filter((trade) => trade.status === "closed");
      const pnl = closed.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0);
      return {
        ...current,
        trades,
        capital: current.startingCapital + pnl,
      };
    });
  }

  return {
    config,
    setConfig,
    state,
    stats,
    openTrades,
    closedTrades,
    start,
    stop,
    paperTrade,
    hydrateHistory,
  };
}
