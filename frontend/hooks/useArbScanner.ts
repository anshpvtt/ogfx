"use client";

import { useEffect, useMemo, useState } from "react";
import { scanForArbitrage } from "@/lib/arbEngine";
import type { ArbOpportunity } from "@/lib/arbTypes";
import { useCryptoPrices } from "@/hooks/useCryptoPrices";

export function useArbScanner() {
  const prices = useCryptoPrices();
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const intervalMs = window.matchMedia("(max-width: 768px)").matches ? 1500 : 1000;
    const interval = window.setInterval(() => {
      if (!document.hidden) setTick(Date.now());
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, []);

  const opportunities = useMemo<ArbOpportunity[]>(() => {
    if (!prices.feed?.exchangePrices?.length) return [];
    return scanForArbitrage(prices.feed.exchangePrices, tick);
  }, [prices.feed?.exchangePrices, tick]);

  const pricePointCount = useMemo(() => prices.feed?.exchangePrices?.length ?? 0, [prices.feed]);

  return {
    ...prices,
    opportunities,
    tick,
    pricePointCount,
  };
}
