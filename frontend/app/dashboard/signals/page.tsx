"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Signal as SignalIcon } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SignalRow = {
  id: string;
  pair: string;
  timeframe: string;
  signal: "BUY" | "SELL" | "NO_SETUP";
  bias: string | null;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  risk_reward: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  confirmation_type: string | null;
  created_at: string;
};

function fmt(value: number | null) {
  return value == null ? "-" : Number(value).toFixed(value > 20 ? 2 : 5);
}

export default function DashboardSignalsPage() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let userId = "";

    async function load() {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      userId = auth.user?.id ?? "";
      if (!userId) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("signals")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);

      setSignals((data as SignalRow[]) ?? []);
      setLoading(false);
    }

    load();
    const interval = window.setInterval(load, 60000);
    const channel = supabase
      .channel("signals-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signals" },
        (payload) => {
          const row = payload.new as SignalRow & { user_id?: string };
          if (!userId || row.user_id !== userId) return;
          setSignals((current) => [row, ...current].slice(0, 20));
        }
      )
      .subscribe();

    return () => {
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Signal stream"
        title="Live signals"
        description="Latest 20 SMC outputs for your account, refreshed every 60 seconds and updated from Supabase realtime inserts."
        actions={
          <Button onClick={() => window.location.reload()} variant="glass" className="rounded-xl">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />

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
                    <div className="text-lg font-semibold text-white">{signal.pair}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{signal.timeframe} / {signal.bias ?? "NEUTRAL"}</div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={signal.signal === "BUY" ? "success" : signal.signal === "SELL" ? "danger" : "secondary"}>
                      {signal.signal}
                    </Badge>
                    <Badge variant="outline" className="border-blue-500/30 text-blue-200">
                      {signal.confidence ?? "LOW"}
                    </Badge>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">Entry</span><div className="font-mono text-white">{fmt(signal.entry)}</div></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">SL</span><div className="font-mono text-red-300">{fmt(signal.stop_loss)}</div></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">TP</span><div className="font-mono text-emerald-300">{fmt(signal.take_profit)}</div></div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><span className="text-slate-500">RR</span><div className="font-mono text-white">{signal.risk_reward ?? "-"}</div></div>
                </div>
                <div className="mt-4 text-xs text-slate-500">
                  {signal.confirmation_type ?? "NONE"} confirmation / {new Date(signal.created_at).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
