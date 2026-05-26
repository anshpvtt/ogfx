"use client";

import { useCallback, useEffect, useState } from "react";
import type { CryptoPriceFeed } from "@/lib/arbTypes";

export function useCryptoPrices() {
  const [feed, setFeed] = useState<CryptoPriceFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/arb/prices", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Price feed failed");
      setFeed(payload);
      setError(payload.warning || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Price feed failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 10000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { feed, loading, error, refresh };
}
