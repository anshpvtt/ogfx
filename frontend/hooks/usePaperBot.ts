"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArbOpportunity, BotConfig, ExecutionTapeEvent, PaperBotEvent, PaperBotState, PaperTrade } from "@/lib/arbTypes";
import { botTick, createInitialBotState, DEFAULT_BOT_CONFIG, paperStats } from "@/lib/paperBroker";

async function postJson(path: string, body: unknown) {
  try {
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Local execution state stays responsive if network sync is interrupted.
  }
}

function tapeFromEvent(event: PaperBotEvent): ExecutionTapeEvent | null {
  if (event.type === "snapshot") return null;
  const pnl = Number(event.trade.pnl || 0);
  const closed = event.type === "closed";
  const profit = pnl >= 0;
  return {
    id: `${event.type}-${event.trade.id}-${event.trade.exitTime || event.trade.entryTime}`,
    type: event.type,
    tone: closed ? (profit ? "profit" : "loss") : "entry",
    title: closed ? (profit ? "CLOSED PROFIT" : "CLOSED LOSS") : "ENTRY LOCKED",
    message: closed
      ? `${event.trade.coin} ${profit ? "+" : ""}$${pnl.toFixed(4)} / ${Number(event.trade.pnlPct || 0).toFixed(3)}%`
      : `${event.trade.coin} ${event.trade.buyExchange} -> ${event.trade.sellExchange}`,
    trade: event.trade,
    timestamp: Date.now(),
  };
}

export function usePaperBot(opportunities: ArbOpportunity[]) {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_BOT_CONFIG);
  const [state, setState] = useState<PaperBotState>(() => createInitialBotState(DEFAULT_BOT_CONFIG));
  const [recentEvents, setRecentEvents] = useState<ExecutionTapeEvent[]>([]);
  const clickAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    clickAudioRef.current = new Audio("/sounds/arb-click.mp3");
    clickAudioRef.current.preload = "auto";
    clickAudioRef.current.volume = 0.42;
  }, []);

  const playTradeClick = useCallback((tone: ExecutionTapeEvent["tone"]) => {
    if (typeof window === "undefined") return;
    const source = clickAudioRef.current ?? new Audio("/sounds/arb-click.mp3");
    const clip = source.cloneNode(true) as HTMLAudioElement;
    clip.volume = tone === "loss" ? 0.34 : 0.5;
    clip.playbackRate = tone === "entry" ? 0.96 : tone === "profit" ? 1.08 : 0.86;
    clip.currentTime = 0;
    void clip.play().catch(() => undefined);
  }, []);

  const publishEvents = useCallback((events: PaperBotEvent[]) => {
    const tape = events.map(tapeFromEvent).filter(Boolean) as ExecutionTapeEvent[];
    if (tape.length) {
      tape.forEach((event, index) => window.setTimeout(() => playTradeClick(event.tone), index * 120));
      setRecentEvents((current) => [...tape, ...current].slice(0, 8));
    }
    for (const event of events) {
      if (event.type === "opened") postJson("/api/arb/trade/open", { trade: event.trade });
      if (event.type === "closed") postJson("/api/arb/trade/close", { trade: event.trade });
      if (event.type === "snapshot") postJson("/api/arb/capital", { capital: event.capital, snapshotAt: event.time });
    }
  }, [playTradeClick]);

  const start = useCallback((nextConfig: BotConfig = config) => {
    const sanitized = {
      ...nextConfig,
      startingCapital: Math.min(10000, Math.max(1, Number(nextConfig.startingCapital) || 1)),
      maxOpenTrades: Math.min(12, Math.max(1, Number(nextConfig.maxOpenTrades) || 8)),
      minSpreadPct: Math.min(5, Math.max(0.05, Number(nextConfig.minSpreadPct) || 0.12)),
    };
    setConfig(sanitized);
    setState((current) => ({
      ...current,
      isRunning: true,
      capital: current.trades.some((trade) => trade.status === "open") ? current.capital : sanitized.startingCapital,
      startingCapital: current.trades.some((trade) => trade.status === "open") ? current.startingCapital : sanitized.startingCapital,
      trades: current.trades.some((trade) => trade.status === "open") ? current.trades : [],
      snapshots: current.trades.some((trade) => trade.status === "open") ? current.snapshots : [{ time: Date.now(), capital: sanitized.startingCapital }],
    }));
    setRecentEvents([]);
    postJson("/api/arb/bot/start", { config: sanitized });
    window.setTimeout(() => {
      setState((current) => {
        if (!current.isRunning) return current;
        const { state: next, events } = botTick(sanitized, current, opportunities, Date.now());
        publishEvents(events);
        return next;
      });
    }, 120);
  }, [config, opportunities, publishEvents]);

  const stop = useCallback(() => {
    setState((current) => ({ ...current, isRunning: false }));
    postJson("/api/arb/bot/stop", {});
  }, []);

  const paperTrade = useCallback((opportunity: ArbOpportunity) => {
    const singleConfig = { ...config, minSpreadPct: Math.max(0.15, opportunity.spreadPercent - 0.001), maxOpenTrades: config.maxOpenTrades + 1 };
    setState((current) => {
      const { state: next, events } = botTick(singleConfig, { ...current, isRunning: true }, [opportunity], Date.now());
      publishEvents(events);
      return { ...next, isRunning: current.isRunning };
    });
  }, [config, publishEvents]);

  useEffect(() => {
    if (!state.isRunning) return;
    const interval = window.setInterval(() => {
      setState((current) => {
        const { state: next, events } = botTick(config, current, opportunities, Date.now());
        publishEvents(events);
        return next;
      });
    }, 650);
    return () => window.clearInterval(interval);
  }, [config, opportunities, publishEvents, state.isRunning]);

  const stats = useMemo(() => paperStats(state.trades, state.capital, state.startingCapital), [state]);
  const openTrades = state.trades.filter((trade) => trade.status === "open");
  const closedTrades = state.trades.filter((trade) => trade.status === "closed");

  const hydrateHistory = useCallback((trades: PaperTrade[]) => {
    setState((current) => {
      if (current.trades.length) return current;
      return {
        ...current,
        trades: trades.slice(0, 150),
      };
    });
  }, []);

  return {
    config,
    setConfig,
    state,
    stats,
    openTrades,
    closedTrades,
    recentEvents,
    start,
    stop,
    paperTrade,
    hydrateHistory,
  };
}
