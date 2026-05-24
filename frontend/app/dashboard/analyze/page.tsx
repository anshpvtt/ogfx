"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Brain, CandlestickChart, ClipboardList, Loader2, NotebookPen, RefreshCw, ShieldCheck, Target } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TRADING_ASSETS } from "@/lib/assets";

const TradingViewAdvancedChart = dynamic(
  () => import("@/components/charts/TradingViewWidgets").then((mod) => mod.TradingViewAdvancedChart),
  { ssr: false }
);
const TradingViewSymbolGrid = dynamic(
  () => import("@/components/charts/TradingViewWidgets").then((mod) => mod.TradingViewSymbolGrid),
  { ssr: false }
);

const SYMBOLS = TRADING_ASSETS.map((asset) => ({ label: asset.id, tv: asset.tradingViewSymbol }));

const TIMEFRAMES = [
  { label: "5m", backend: "1H", tv: "5" },
  { label: "15m", backend: "1H", tv: "15" },
  { label: "1h", backend: "1H", tv: "60" },
  { label: "4h", backend: "4H", tv: "240" },
] as const;

function toBackendSymbol(tv: string) {
  const asset = TRADING_ASSETS.find((item) => item.tradingViewSymbol === tv);
  if (asset) return asset.id;
  return "XAUUSD";
}

function formatValue(value: number | null | undefined, digits = 3) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

export default function AnalyzePage() {
  const [activeTv, setActiveTv] = useState<string>(SYMBOLS[0].tv);
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>(TIMEFRAMES[1]);
  const [playbook, setPlaybook] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [chartImage, setChartImage] = useState("");

  const backendSymbol = useMemo(() => toBackendSymbol(activeTv), [activeTv]);

  useEffect(() => {
    const storageKey = `ogfx-analyze-notes:${backendSymbol}`;
    setNotes(typeof window !== "undefined" ? window.localStorage.getItem(storageKey) || "" : "");
  }, [backendSymbol]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const snapshotResponse = await fetch(`/api/market/snapshot?pair=${encodeURIComponent(backendSymbol)}&timeframe=${timeframe.backend}`);
        const snapshotPayload = await snapshotResponse.json();
        if (!snapshotResponse.ok) throw new Error(snapshotPayload.error || "Failed to load market snapshot");
        const snapshot = snapshotPayload.snapshots?.[0];
        if (!snapshot?.latest) throw new Error("No live market snapshot available");

        const agentResponse = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetId: backendSymbol,
            interval: timeframe.backend,
            snapshot,
            imageDataUrl: chartImage || undefined,
            strategyLogic: {
              source: "OGFX analysis page",
              rule: "Use the user's SMC datasets, liquidity sweep logic, BOS/MSS confirmation, TP/SL discipline, and risk preservation rules.",
            },
            requireGemma: true,
          }),
        });
        const rawAgent = await agentResponse.text();
        const agentPayload = rawAgent ? JSON.parse(rawAgent) : {};
        if (!agentResponse.ok) throw new Error(agentPayload.error || "Gemma analysis failed");
        const decision = agentPayload.decision;
        const response = {
          success: true,
          symbol: backendSymbol,
          timeframe: timeframe.backend,
          provider: decision?.mode === "local-demo" ? "local-demo" : decision?.model,
          market: snapshot,
          playbook: {
            grade: decision?.confidence >= 75 ? "A" : decision?.confidence >= 60 ? "B" : "C",
            score: decision?.confidence ?? 0,
            direction: decision?.decision ?? "WAIT",
            actionable: decision?.decision === "BUY" || decision?.decision === "SELL",
            summary: decision?.summary,
            signal: {
              entry: decision?.entry,
              stopLoss: decision?.stopLoss,
              takeProfit: decision?.takeProfit,
              riskReward: decision?.riskReward,
            },
            checklist: [
              { label: "AI model response", passed: decision?.mode !== "local-demo" },
              { label: "OGFX dataset logic included", passed: true },
              { label: "TP/SL defined", passed: Boolean(decision?.stopLoss && decision?.takeProfit) },
              { label: "Trade bias selected", passed: decision?.decision !== "WAIT" },
            ],
            reasoning: decision?.reasons ?? [],
            market: {
              trend: snapshot?.trend,
              atr: snapshot?.atr,
              close: snapshot?.latest?.close,
              ema20: snapshot?.ema20,
              ema50: snapshot?.ema50,
              liquidity: {
                sellSide: snapshot?.latest?.low,
                buySide: snapshot?.latest?.high,
              },
            },
          },
          timestamp: new Date().toISOString(),
        };
        if (!cancelled) {
          setPlaybook(response);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load playbook analysis");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [backendSymbol, timeframe, refreshNonce, chartImage]);

  const market = playbook?.market;
  const lsbr = playbook?.playbook;
  const signal = lsbr?.signal;

  const saveNotes = (value: string) => {
    setNotes(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`ogfx-analyze-notes:${backendSymbol}`, value);
    }
  };

  const attachChartImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Attach a chart image file.");
      return;
    }
    if (file.size > 4_500_000) {
      setError("Image is too large. Use a chart screenshot under 4.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setChartImage(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Analysis studio"
        title="LSBR market analysis"
        description="Live TradingView charting, LSBR playbook scoring from your PDF strategy, and execution-ready setup checks in one workspace."
        actions={
          <>
            <Button asChild variant="glass" className="rounded-xl">
              <Link href="/dashboard/backtest">Open Backtest Lab</Link>
            </Button>
            <Button
              onClick={() => {
                setRefreshNonce((value) => value + 1);
              }}
              className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh setup
            </Button>
            <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10">
              <input type="file" accept="image/*" className="sr-only" onChange={(event) => attachChartImage(event.target.files?.[0])} />
              {chartImage ? "Image attached" : "Attach chart image"}
            </label>
          </>
        }
      />

        <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
          <div className="space-y-6">
            <Card className="overflow-hidden rounded-[32px] border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]">
              <CardHeader className="border-b border-white/10">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <CandlestickChart className="h-5 w-5 text-cyan-300" />
                      TradingView chart workspace
                    </CardTitle>
                    <CardDescription className="text-slate-400">
              Gemma reads your OGFX strategy logic while TradingView stays as the live chart workspace.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TIMEFRAMES.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => setTimeframe(item)}
                        className={[
                          "rounded-full border px-4 py-2 text-sm transition-colors",
                          timeframe.label === item.label
                            ? "border-cyan-400/30 bg-cyan-400/10 text-white"
                            : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white",
                        ].join(" ")}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {SYMBOLS.map((symbol) => {
                    const active = symbol.tv === activeTv;
                    return (
                      <button
                        key={symbol.tv}
                        type="button"
                        onClick={() => setActiveTv(symbol.tv)}
                        className={[
                          "rounded-2xl border px-4 py-3 text-left transition-all",
                          active
                            ? "border-cyan-400/40 bg-cyan-400/10 text-white"
                            : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:text-white",
                        ].join(" ")}
                      >
                        <div className="text-sm font-semibold">{symbol.label}</div>
                        <div className="mt-1 text-[11px] opacity-70">{symbol.tv}</div>
                      </button>
                    );
                  })}
                </div>

                <TradingViewAdvancedChart symbol={activeTv} interval={timeframe.tv} height={620} />
              </CardContent>
            </Card>

            <TradingViewSymbolGrid symbols={[...SYMBOLS]} activeTvSymbol={activeTv} onPick={setActiveTv} />

            <div className="grid gap-4 md:grid-cols-4">
              {[
                { label: "Provider", value: playbook?.provider?.toUpperCase() || "-" },
                { label: "Trend", value: lsbr?.market?.trend || "-" },
                { label: "ATR", value: formatValue(lsbr?.market?.atr, backendSymbol.includes("JPY") ? 3 : 5) },
                { label: "Close", value: formatValue(lsbr?.market?.close, backendSymbol.includes("JPY") ? 3 : 5) },
              ].map((item) => (
                <Card key={item.label} className="rounded-[28px] border-white/10 bg-white/[0.04]">
                  <CardContent className="p-5">
                    <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{item.label}</div>
                    <div className="mt-3 text-2xl font-semibold text-white">{item.value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <Card className="rounded-[32px] border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),rgba(255,255,255,0.03))]">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-white">
                  <span className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-cyan-300" />
                    LSBR playbook
                  </span>
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                    {lsbr?.grade || "-"} / {lsbr?.score ?? 0}
                  </span>
                </CardTitle>
                <CardDescription className="text-slate-300">
                  Gemma response constrained by your OGFX SMC datasets: liquidity sweep, BOS/MSS, TP/SL, and risk preservation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {error ? <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
                {loading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Evaluating live setup quality...
                  </div>
                ) : (
                  <>
                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Bias</div>
                          <div className="mt-2 text-2xl font-semibold text-white">{lsbr?.direction || "WAIT"}</div>
                        </div>
                        <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                          {lsbr?.actionable ? "Actionable" : "Wait"}
                        </div>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-slate-300">{lsbr?.summary || "No setup summary yet."}</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        { label: "Entry", value: formatValue(signal?.entry, backendSymbol.includes("JPY") ? 3 : 5) },
                        { label: "Stop", value: formatValue(signal?.stopLoss, backendSymbol.includes("JPY") ? 3 : 5) },
                        { label: "Target", value: formatValue(signal?.takeProfit, backendSymbol.includes("JPY") ? 3 : 5) },
                        { label: "R:R", value: signal?.riskReward ? `${signal.riskReward}:1` : "-" },
                      ].map((item) => (
                        <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</div>
                          <div className="mt-2 text-lg font-semibold text-white">{item.value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                      <div className="mb-4 flex items-center gap-2 text-white">
                        <ClipboardList className="h-4 w-4 text-cyan-300" />
                        Setup checklist
                      </div>
                      <div className="space-y-3">
                        {(lsbr?.checklist || []).map((item: any) => (
                          <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <span className="text-sm text-slate-200">{item.label}</span>
                            <span className={item.passed ? "text-emerald-300" : "text-amber-200"}>
                              {item.passed ? "Pass" : "Pending"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                      <div className="mb-4 flex items-center gap-2 text-white">
                        <ShieldCheck className="h-4 w-4 text-cyan-300" />
                        Setup reasoning
                      </div>
                      <ul className="space-y-2 text-sm text-slate-300">
                        {(lsbr?.reasoning || []).map((reason: string) => (
                          <li key={reason}>- {reason}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                      <div className="mb-4 flex items-center gap-2 text-white">
                        <NotebookPen className="h-4 w-4 text-cyan-300" />
                        Session journal
                      </div>
                      <textarea
                        value={notes}
                        onChange={(event) => saveNotes(event.target.value)}
                        placeholder="Mark your POI, liquidity pools, reasons to wait, and risk notes here..."
                        className="min-h-[160px] w-full rounded-2xl border border-white/10 bg-[#060d17] px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-400/40"
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-[32px] border-white/10 bg-white/[0.04]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Target className="h-5 w-5 text-cyan-300" />
                  Market map
                </CardTitle>
                <CardDescription className="text-slate-400">
                  Nearest liquidity pools and moving-average bias from the active LSBR scan.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: "Sell-side liquidity", value: formatValue(lsbr?.market?.liquidity?.sellSide, backendSymbol.includes("JPY") ? 3 : 5) },
                  { label: "Buy-side liquidity", value: formatValue(lsbr?.market?.liquidity?.buySide, backendSymbol.includes("JPY") ? 3 : 5) },
                  { label: "EMA 20", value: formatValue(lsbr?.market?.ema20, backendSymbol.includes("JPY") ? 3 : 5) },
                  { label: "EMA 50", value: formatValue(lsbr?.market?.ema50, backendSymbol.includes("JPY") ? 3 : 5) },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</div>
                    <div className="mt-2 text-lg font-semibold text-white">{item.value}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
    </div>
  );
}
