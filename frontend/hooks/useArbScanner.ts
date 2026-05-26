"use client";

import { useEffect, useMemo, useState } from "react";
import { scanForArbitrage } from "@/lib/arbEngine";
import type { ArbOpportunity } from "@/lib/arbTypes";
import { useCryptoPrices } from "@/hooks/useCryptoPrices";

export function useArbScanner() {
  const prices = useCryptoPrices();
  const [opportunities, setOpportunities] = useState<ArbOpportunity[]>([]);
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!prices.feed?.exchangePrices?.length) return;
    setOpportunities(scanForArbitrage(prices.feed.exchangePrices, tick));
  }, [prices.feed, tick]);

  const pricePointCount = useMemo(() => prices.feed?.exchangePrices?.length ?? 0, [prices.feed]);

  return {
    ...prices,
    opportunities,
    tick,
    pricePointCount,
  };
}
