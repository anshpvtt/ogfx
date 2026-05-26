"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BarChart3, CalendarDays, Loader2, Play, SlidersHorizontal } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { BACKTEST_TIMEFRAMES, TRADING_ASSETS, groupTradingAssets } from "@/lib/assets";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { backendJson } from "@/lib/backend-api";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const EquityChart = dynamic(() => import("@/components/EquityChart"), {
  ssr: false,
  loading: () => <div className="h-60 rounded-2xl bg-white/[0.035]" />,
});

type BacktestPayload = {
  backtestId: string;
  summary: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    maxDrawdown: number;
    finalBalance: number;
    sharpeRatio: number;
  };
  equityCurve: Array<{ date: string; balance: number }>;
  tradeLog: Array<{
    index: number;
    date: string;
    type: "BUY" | "SELL";
    entry: number;
    sl: number;
    tp: number;
    result: "WIN" | "LOSS" | "TIMEOUT";
    pnl: number;
    balance: number;
    rr: number;
  }>;
};

const groupedAssets = groupTradingAssets();

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtPrice(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(Math.abs(Number(value)) > 20 ? 2 : 5);
}

export default function DashboardBacktestPage() {
  const [pair, setPair] = useState<string>(TRADING_ASSETS[0].id);
  const [timeframe, setTimeframe] = useState<(typeof BACKTEST_TIMEFRAMES)[number]["value"]>("1H");
  const [startDate, setStartDate] = useState(() => isoDaysAgo(365));
  const [endDate, setEndDate] = useState(() => todayIso());
  const [category, setCategory] = useState<"All" | keyof typeof groupedAssets>("All");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [result, setResult] = useState<BacktestPayload | null>(null);

  const activeAsset = TRADING_ASSETS.find((asset) => asset.id === pair) ?? TRADING_ASSETS[0];
  const visibleAssets = useMemo(
    () => (category === "All" ? TRADING_ASSETS : groupedAssets[category]),
    [category]
  );

  const equityData = useMemo(() => {
    return (result?.equityCurve ?? []).map((point, index) => ({
      label: point.date ? new Date(point.date).toLocaleDateString() : String(index + 1),
      pnl: Number(point.balance ?? 0) - 10000,
      equity: Number(point.balance ?? 0),
    }));
  }, [result]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? "");
    });
  }, []);

  async function run() {
    setLoading(true);
    setError("");
    try {
      if (!userId) throw new Error("Authentication required before running a backtest");
      if (!startDate || !endDate) throw new Error("Select both start and end dates");
      if (new Date(startDate) >= new Date(endDate)) throw new Error("End date must be after start date");

      const payload = await backendJson<any>("/api/backtest/run", {
        method: "POST",
        body: JSON.stringify({ userId, symbol: pair, timeframe, startDate, endDate }),
      });
      const backendResult = payload.result ?? {};
      setResult({
        backtestId: payload.backtestRun?.id ?? crypto.randomUUID(),
        summary: {
          totalTrades: backendResult.totalTrades ?? 0,
          winRate: backendResult.winRate ?? 0,
          profitFactor: backendResult.profitFactor ?? 0,
          maxDrawdown: backendResult.maxDrawdown ?? 0,
          finalBalance: backendResult.finalBalance ?? 10000,
          sharpeRatio: backendResult.sharpeRatio ?? 0,
        },
        equityCurve: backendResult.equityCurve ?? [],
        tradeLog: backendResult.tradeLog ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.summary;
  const metricCards = [
    ["Trades", summary?.totalTrades ?? "-"],
    ["Win rate", summary ? `${summary.winRate}%` : "-"],
    ["Profit factor", summary?.profitFactor ?? "-"],
    ["Max drawdown", summary ? `${summary.maxDrawdown}%` : "-"],
    ["Sharpe", summary?.sharpeRatio ?? "-"],
    ["Final balance", summary ? `$${summary.finalBalance.toLocaleString()}` : "-"],
  ];

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Backtest lab"
        title="Backtest every OGFX asset"
        description="Run the SMC engine over forex, metals, crypto, energy, and index markets. Results are saved to Supabase with equity curves and trade logs for later review."
        actions={
          <>
            <Button asChild variant="glass" className="rounded-xl">
              <Link href="/dashboard/charts">Open live charts</Link>
            </Button>
            <Button onClick={run} disabled={loading} className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {loading ? "Running 10-30s" : "Run backtest"}
            </Button>
          </>
        }
      />

      <section className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Card className="rounded-3xl border-white/10 bg-[#0b1420]/88 shadow-[0_30px_100px_rgba(0,0,0,0.28)]">
          <CardContent className="space-y-6 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <SlidersHorizontal className="h-4 w-4 text-cyan-200" />
              Test configuration
            </div>

            <div>
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Asset class</div>
              <div className="flex flex-wrap gap-2">
                {(["All", ...Object.keys(groupedAssets)] as Array<"All" | keyof typeof groupedAssets>).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCategory(item)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      category === item
                        ? "border-cyan-300/30 bg-cyan-300/10 text-white"
                        : "border-white/10 text-slate-400 hover:border-white/20 hover:text-white"
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              {visibleAssets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setPair(asset.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all",
                    pair === asset.id
                      ? "border-cyan-300/35 bg-cyan-300/10 text-white shadow-[0_0_26px_rgba(34,211,238,0.1)]"
                      : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:text-white"
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: asset.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{asset.id}</span>
                    <span className="block truncate text-xs text-slate-500">{asset.name}</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{asset.category}</span>
                </button>
              ))}
            </div>

            <div>
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-slate-500">Timeframe</div>
              <div className="grid grid-cols-3 gap-2">
                {BACKTEST_TIMEFRAMES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setTimeframe(item.value)}
                    className={cn(
                      "rounded-2xl border px-3 py-3 text-center transition-colors",
                      timeframe === item.value
                        ? "border-amber-200/35 bg-amber-200/10 text-white"
                        : "border-white/10 bg-black/20 text-slate-400 hover:border-white/20 hover:text-white"
                    )}
                  >
                    <span className="block text-sm font-bold">{item.label}</span>
                    <span className="mt-1 block text-[10px] text-slate-500">{item.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
                <CalendarDays className="h-3.5 w-3.5" />
                Range
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block text-sm text-slate-400">
                  Start date
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white outline-none transition-colors focus:border-cyan-300/40"
                  />
                </label>
                <label className="block text-sm text-slate-400">
                  End date
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white outline-none transition-colors focus:border-cyan-300/40"
                  />
                </label>
              </div>
            </div>

            <Button onClick={run} disabled={loading} className="h-12 w-full rounded-2xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {loading ? "Running 10-30s" : `Run ${activeAsset.id}`}
            </Button>
            {error ? <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="rounded-3xl border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),rgba(255,255,255,0.04)_42%,rgba(255,255,255,0.025))]">
            <CardContent className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-cyan-100">{activeAsset.category}</div>
                  <h2 className="mt-1 text-2xl font-black text-white">{activeAsset.id} backtest report</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{activeAsset.description}</p>
                </div>
                <Button asChild variant="glass" className="rounded-xl">
                  <Link href="/dashboard/charts">
                    Watch live chart <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {metricCards.map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
                    <div className="mt-2 text-2xl font-bold text-white">{value}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-white/10 bg-[#0b1420]/88">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <BarChart3 className="h-4 w-4 text-cyan-200" />
                Equity curve
              </div>
              <span className="text-xs text-slate-500">{result?.backtestId ? `Run ${result.backtestId.slice(0, 8)}` : "Awaiting run"}</span>
            </div>
            <CardContent className="p-5">
              <EquityChart data={equityData} />
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-3xl border-white/10 bg-white/[0.035]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-white">Trade log</div>
                <div className="text-xs text-slate-500">Latest run entries, exits, R:R, PnL, and balance trail.</div>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                {result?.tradeLog.length ?? 0} trades
              </span>
            </div>
            <CardContent className="p-0">
              {result?.tradeLog.length ? (
                <div className="overflow-x-auto">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Side</th>
                        <th>Entry</th>
                        <th>SL</th>
                        <th>TP</th>
                        <th>Result</th>
                        <th>R:R</th>
                        <th>PnL</th>
                        <th>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.tradeLog.slice(0, 80).map((trade) => (
                        <tr key={`${trade.date}-${trade.index}`}>
                          <td>{new Date(trade.date).toLocaleDateString()}</td>
                          <td className={trade.type === "BUY" ? "buy-val" : "sell-val"}>{trade.type}</td>
                          <td>{fmtPrice(trade.entry)}</td>
                          <td className="sell-val">{fmtPrice(trade.sl)}</td>
                          <td className="buy-val">{fmtPrice(trade.tp)}</td>
                          <td>{trade.result}</td>
                          <td>{trade.rr}</td>
                          <td className={trade.pnl >= 0 ? "pos" : "neg"}>{trade.pnl.toFixed(2)}</td>
                          <td>{trade.balance.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-sm text-slate-400">
                  Run a backtest to populate the trade log. If the engine finds no confirmed setup, this table stays empty by design.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
