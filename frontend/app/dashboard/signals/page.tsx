"use client";

import { useEffect, useState } from "react";
import { Loader2, Play, RefreshCw, Signal as SignalIcon } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SignalRow = {
  id: string;
  symbol?: string;
  pair?: string;
  timeframe: string;
  signal?: "BUY" | "SELL" | "NO_SETUP" | "WAIT";
  direction?: "BUY" | "SELL";
  bias: string | null;
  entry?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  risk_reward?: number | null;
  rr_ratio?: number | null;
  rrRatio?: number | null;
  confidence: number | string | null;
  confirmation_type?: string | null;
  reason?: string | null;
  reasoning?: string | null;
  setup_type?: string | null;
  strategy_alignment?: string | null;
  gemma_analysis?: string | null;
  checklist?: Array<{ label: string; status: "pass" | "pending" | "fail" }>;
  created_at?: string;
  createdAt?: string;
};

function fmt(value: number | null | undefined) {
  return value == null ? "-" : Number(value).toFixed(value > 20 ? 2 : 5);
}

function confidenceNumber(value: SignalRow["confidence"]) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.toUpperCase() === "HIGH") return 85;
    if (value.toUpperCase() === "MEDIUM") return 62;
    if (value.toUpperCase() === "LOW") return 38;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function confidenceLabel(value: SignalRow["confidence"]) {
  return typeof value === "string" && Number.isNaN(Number(value)) ? value : `${confidenceNumber(value)}%`;
}

export default function DashboardSignalsPage() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forceLoading, setForceLoading] = useState(false);
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("");
  const [pairFilter, setPairFilter] = useState("ALL");

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function load() {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const nextUserId = auth.user?.id ?? "";
      setUserId(nextUserId);
      if (!nextUserId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("signals")
          .select("*")
          .eq("user_id", nextUserId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw new Error(error.message);
        setSignals(data ?? []);
        setMessage("");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to load signals");
      }
      setLoading(false);
    }

    load();
    const interval = window.setInterval(load, 60000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function forceScanNow() {
    if (!userId) {
      setMessage("Authentication required before forcing a scan.");
      return;
    }
    setForceLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/signals/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair: "XAUUSD", timeframe: "1H" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Force scan failed");

      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("signals")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      setSignals(data ?? []);
      setMessage("Force scan complete.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Force scan failed");
    } finally {
      setForceLoading(false);
    }
  }

  async function forceAnalyzePair(pair: string) {
    setForceLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair, timeframe: "1H" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "AI analyze failed");
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("signals")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      setSignals(data ?? []);
      setMessage(payload.analysis?.warning || "AI scan complete.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI analyze failed");
    } finally {
      setForceLoading(false);
    }
  }

  async function applyToDemo(signal: SignalRow) {
    const side = signal.direction ?? signal.signal;
    const entry = Number(signal.entry);
    const stopLoss = Number(signal.stop_loss ?? signal.stopLoss);
    const takeProfit = Number(signal.take_profit ?? signal.takeProfit);
    if (side !== "BUY" && side !== "SELL") {
      setMessage("Only BUY/SELL signals can be applied to demo.");
      return;
    }
    const response = await fetch("/api/demo/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetId: signal.symbol ?? signal.pair,
        side,
        entry,
        stopLoss,
        takeProfit,
        size: 1,
        source: "agent",
        confidence: confidenceNumber(signal.confidence),
        reason: signal.reasoning ?? signal.reason,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Signal applied to demo account." : payload.error || "Could not apply signal.");
  }

  const pairs = Array.from(new Set(signals.map((signal) => signal.symbol ?? signal.pair).filter(Boolean) as string[]));
  const visibleSignals = pairFilter === "ALL"
    ? signals
    : signals.filter((signal) => (signal.symbol ?? signal.pair) === pairFilter);

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Signal stream"
        title="Live signals"
        description="Latest 20 SMC outputs for your account, refreshed every 60 seconds and updated from Supabase realtime inserts."
        actions={
          <Button onClick={forceScanNow} disabled={forceLoading} variant="glass" className="rounded-xl">
            {forceLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Force scan now
          </Button>
        }
      />
      {message ? <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">{message}</div> : null}

      <div className="flex flex-wrap gap-2">
        {["ALL", "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", ...pairs.filter((pair) => !["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD"].includes(pair))].map((pair) => (
          <button
            key={pair}
            onClick={() => pair === "ALL" ? setPairFilter(pair) : forceAnalyzePair(pair)}
            onDoubleClick={() => setPairFilter(pair)}
            className={`rounded-full border px-4 py-2 text-sm ${pairFilter === pair ? "border-cyan-300/50 bg-cyan-300/10 text-white" : "border-white/10 text-slate-400 hover:text-white"}`}
            disabled={forceLoading && pair !== "ALL"}
            title={pair === "ALL" ? "Show all signals" : "Click to force an AI scan, double click to filter"}
          >
            {pair}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-56 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.035] text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading signals
        </div>
      ) : !visibleSignals.length ? (
        <Card className="rounded-3xl border-white/10 bg-[#0b1420]/84">
          <CardContent className="flex min-h-56 flex-col items-center justify-center text-center">
            <SignalIcon className="h-10 w-10 text-cyan-200" />
            <div className="mt-3 font-semibold text-white">No signals yet</div>
            <p className="mt-1 text-sm text-slate-400">Generate a signal from the API or run a backtest to start building history.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {visibleSignals.map((signal) => (
            <Card key={signal.id} className="rounded-3xl border-white/10 bg-[#0b1420]/84 transition hover:border-cyan-300/30">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-white">{signal.symbol ?? signal.pair}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                      {signal.timeframe} / {signal.setup_type ?? signal.confirmation_type ?? signal.bias ?? "NEUTRAL"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={(signal.direction ?? signal.signal) === "BUY" ? "success" : (signal.direction ?? signal.signal) === "SELL" ? "danger" : "secondary"}>
                      {signal.direction ?? signal.signal}
                    </Badge>
                    <Badge variant="outline" className="border-blue-500/30 text-blue-200">
                      {confidenceLabel(signal.confidence)}
                    </Badge>
                  </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-cyan-300" style={{ width: `${Math.max(0, Math.min(100, confidenceNumber(signal.confidence)))}%` }} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">Entry</span><div className="font-mono text-white">{fmt(signal.entry)}</div></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">SL</span><div className="font-mono text-red-300">{fmt(signal.stop_loss ?? signal.stopLoss ?? null)}</div></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">TP</span><div className="font-mono text-emerald-300">{fmt(signal.take_profit ?? signal.takeProfit ?? null)}</div></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">RR</span><div className="font-mono text-white">{signal.rr_ratio ?? signal.risk_reward ?? signal.rrRatio ?? "-"}</div></div>
                </div>
                {signal.checklist?.length ? (
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {signal.checklist.map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs">
                        <span className="text-slate-300">{item.label}</span>
                        <span className={item.status === "pass" ? "text-emerald-200" : item.status === "fail" ? "text-red-200" : "text-amber-200"}>{item.status}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-5 space-y-2 text-sm text-slate-300">
                  <p>{signal.reasoning ?? signal.reason ?? signal.gemma_analysis ?? "No reasoning stored."}</p>
                  {signal.strategy_alignment ? <p className="text-amber-100">{signal.strategy_alignment}</p> : null}
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                  <span>{new Date(signal.created_at ?? signal.createdAt ?? Date.now()).toLocaleString()}</span>
                  <Button onClick={() => applyToDemo(signal)} variant="glass" className="rounded-xl">
                    <Play className="mr-2 h-4 w-4" />
                    Apply to demo
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
