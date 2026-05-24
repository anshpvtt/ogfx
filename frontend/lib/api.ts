const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("ogfx_token") : null;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API ${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface Signal {
  id: string;
  symbol: string;
  signal: "BUY" | "SELL" | "SKIP";
  confidence: number;
  reason: string;
  strategy_id: string | null;
  strategy_name: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  risk_reward: number | null;
  rsi: number | null;
  ema_50: number | null;
  ema_200: number | null;
  macd: number | null;
  market_bias: string | null;
  key_factors: string[] | null;
  status: "pending" | "executed" | "failed" | "cancelled";
  created_at: string;
}

export interface Trade {
  id: string;
  signal_id: string | null;
  symbol: string;
  direction: "BUY" | "SELL";
  entry_price: number;
  exit_price: number | null;
  stop_loss: number;
  take_profit: number;
  lot_size: number;
  pnl: number | null;
  status: "open" | "closed" | "cancelled";
  opened_at: string;
  closed_at: string | null;
  mt5_ticket: number | null;
}

export interface Stats {
  total_trades: number;
  closed_trades: number;
  open_trades: number;
  win_rate: number;
  total_pnl: number;
  signals_today: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  risk_reward: number;
  win_rate_historical: number;
  instruments: string[];
  timeframes: string[];
  is_active?: boolean;
}

export const api = {
  sendOtp: (phone: string) =>
    apiFetch<{ success: boolean; message: string; otp?: string }>("/auth/send-otp", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),

  verifyOtp: (phone: string, otp: string) =>
    apiFetch<{ success: boolean; token: string; user: { id: string; phone: string } }>("/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ phone, otp }),
    }),

  getSignals: (limit = 50, symbol?: string) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (symbol) qs.set("pair", symbol);
    return apiFetch<{ signals: Signal[]; count: number }>(`/signals/?${qs}`);
  },

  getStats: () =>
    apiFetch<any>("/signals/stats"),

  analyze: (symbol: string) =>
    apiFetch<{ success: boolean; symbol: string; result: any; timestamp: string }>("/analyze/", {
      method: "POST",
      body: JSON.stringify({ symbol }),
    }),

  getSmcAnalysis: (symbol: string) =>
    apiFetch<{ success: boolean; symbol: string; analysis: any; timestamp: string }>(`/analyze/smc/${encodeURIComponent(symbol)}`),

  getEliteAnalysis: (symbol: string) =>
    apiFetch<{ success: boolean; symbol: string; analysis: any; timestamp: string }>(`/analyze/elite/${encodeURIComponent(symbol)}`),

  getPlaybookAnalysis: (symbol: string, timeframe = "15m") =>
    apiFetch<{
      success: boolean;
      symbol: string;
      timeframe: string;
      provider: string;
      market: any;
      playbook: any;
      engine: any;
      timestamp: string;
    }>(`/analyze/playbook/${encodeURIComponent(symbol)}?timeframe=${encodeURIComponent(timeframe)}`),

  runBacktest: (body: {
    pair: string;
    timeframe?: "1m" | "5m" | "15m" | "1h";
    strategy?: "ELITE" | "LSBR";
    limit?: number;
    initial_balance?: number;
    min_confidence?: number;
  }) =>
    apiFetch<{
      success: boolean;
      backtest: any;
      result: any;
      provider?: string;
      timestamp: string;
    }>("/backtest", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listBacktests: (limit = 50) =>
    apiFetch<{ success: boolean; backtests: any[] }>(`/backtests?limit=${limit}`),

  getBacktest: (id: string) =>
    apiFetch<{ success: boolean; backtest: any; trades: any[] }>(`/backtests/${id}`),

  health: () =>
    apiFetch<{ status: string; timestamp?: string }>("/health"),
};
