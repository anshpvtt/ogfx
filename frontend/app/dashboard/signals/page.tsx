"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Signal as SignalIcon } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { backendJson } from "@/lib/backend-api";
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
  rrRatio?: number | null;
  confidence: number | null;
  confirmation_type?: string | null;
  reason?: string | null;
  created_at?: string;
  createdAt?: string;
};

function fmt(value: number | null | undefined) {
  return value == null ? "-" : Number(value).toFixed(value > 20 ? 2 : 5);
}

export default function DashboardSignalsPage() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forceLoading, setForceLoading] = useState(false);
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("");

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
        const payload = await backendJson<{ signals: SignalRow[] }>(`/api/signals/${nextUserId}?limit=20`);
        setSignals(payload.signals ?? []);
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
      await backendJson("/api/signal/generate", {
        method: "POST",
        body: JSON.stringify({ userId, symbol: "XAUUSD", timeframe: "1h" }),
      });
      const payload = await backendJson<{ signals: SignalRow[] }>(`/api/signals/${userId}?limit=20`);
      setSignals(payload.signals ?? []);
      setMessage("Force scan complete.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Force scan failed");
    } finally {
      setForceLoading(false);
    }
  }

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

      {loading ? (
        <div className="flex min-h-56 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.035] text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading signals
        </div>
      ) : !signals.length ? (
        <Card className="rounded-3xl border-white/10 bg-[#0b1420]/84">
          <CardContent className="flex min-h-56 flex-col items-center justify-center text-center">
            <SignalIcon className="h-10 w-10 text-cyan-200" />
            <div className="mt-3 font-semibold text-white">No signals yet</div>
            <p className="mt-1 text-sm text-slate-400">Generate a signal from the API or run a backtest to start building history.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {signals.map((signal) => (
            <Card key={signal.id} className="rounded-3xl border-white/10 bg-[#0b1420]/84 transition hover:border-cyan-300/30">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-white">{signal.symbol ?? signal.pair}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{signal.timeframe} / {signal.bias ?? "NEUTRAL"}</div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={(signal.direction ?? signal.signal) === "BUY" ? "success" : (signal.direction ?? signal.signal) === "SELL" ? "danger" : "secondary"}>
                      {signal.direction ?? signal.signal}
                    </Badge>
                    <Badge variant="outline" className="border-blue-500/30 text-blue-200">
                      {signal.confidence ?? 0}%
                    </Badge>
                  </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-cyan-300" style={{ width: `${Math.max(0, Math.min(100, Number(signal.confidence ?? 0)))}%` }} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">Entry</span><div className="font-mono text-white">{fmt(signal.entry)}</div></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">SL</span><div className="font-mono text-red-300">{fmt(signal.stop_loss ?? signal.stopLoss ?? null)}</div></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">TP</span><div className="font-mono text-emerald-300">{fmt(signal.take_profit ?? signal.takeProfit ?? null)}</div></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">RR</span><div className="font-mono text-white">{signal.risk_reward ?? signal.rrRatio ?? "-"}</div></div>
                </div>
                <div className="mt-4 text-xs text-slate-500">
                  {signal.reason ?? signal.confirmation_type ?? "NONE"} / {new Date(signal.created_at ?? signal.createdAt ?? Date.now()).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
