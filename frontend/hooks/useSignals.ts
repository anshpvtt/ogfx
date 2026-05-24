"use client";

import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "./useWebSocket";

export interface Signal {
  id: string;
  pair: string;
  type: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reason: string;
  timestamp: string;
  status: "ACTIVE" | "CLOSED" | "CANCELLED";
  pips?: number;
}

interface UseSignalsOptions {
  apiUrl?: string;
  wsUrl?: string;
  autoConnect?: boolean;
}

export function useSignals({
  apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
  wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001/ws",
  autoConnect = true,
}: UseSignalsOptions = {}) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial signals
  const fetchSignals = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${apiUrl}/signals`);
      if (!response.ok) throw new Error("Failed to fetch signals");
      const data = await response.json();
      setSignals(data.signals || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [apiUrl]);

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((message: { type: string; data: unknown }) => {
    switch (message.type) {
      case "NEW_SIGNAL":
        setSignals((prev) => [message.data as Signal, ...prev]);
        break;
      case "SIGNAL_UPDATE":
        setSignals((prev) =>
          prev.map((s) =>
            s.id === (message.data as Signal).id ? (message.data as Signal) : s
          )
        );
        break;
      case "SIGNALS_BATCH":
        setSignals(message.data as Signal[]);
        break;
    }
  }, []);

  // WebSocket connection
  const { isConnected } = useWebSocket({
    url: wsUrl,
    onMessage: handleWebSocketMessage,
  });

  // Initial fetch
  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchSignals]);

  // Subscribe/unsubscribe
  const subscribe = useCallback(
    async (pair: string) => {
      try {
        const response = await fetch(`${apiUrl}/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pair }),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    [apiUrl]
  );

  const unsubscribe = useCallback(
    async (pair: string) => {
      try {
        const response = await fetch(`${apiUrl}/unsubscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pair }),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    [apiUrl]
  );

  return {
    signals,
    isLoading,
    error,
    isConnected,
    isLive: isConnected,
    refetch: fetchSignals,
    subscribe,
    unsubscribe,
    activeSignals: signals.filter((s) => s.status === "ACTIVE"),
    closedSignals: signals.filter((s) => s.status === "CLOSED"),
  };
}
