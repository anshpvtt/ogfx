"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";

const EquityChart = dynamic(() => import("@/components/EquityChart"), {
  ssr: false,
  loading: () => <div className="h-60 rounded-2xl bg-white/[0.035]" />,
});

function fmt(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "-";
}

export default function BacktestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.getBacktest(String(id));
        if (!mounted) return;
        setBacktest(res.backtest);
        setTrades(res.trades || []);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Failed to load backtest");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  const equityData = useMemo(() => {
    return trades
      .filter((trade) => trade.balance != null)
      .map((trade: any, index: number) => ({
        label: String(index + 1),
        pnl: (trade.balance ?? 0) - (backtest?.initial_balance ?? 0),
        equity: trade.balance ?? 0,
      }));
  }, [trades, backtest]);

  if (loading) {
    return (
      <div className="flex min-h-80 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.035] text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading backtest
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Backtest report"
        title="Backtest detail"
        description={`${backtest?.pair ?? "Run"} ${backtest?.timeframe ?? ""} ${backtest?.strategy_name ?? "SMC engine"}`}
        actions={
          <Button asChild variant="glass" className="rounded-xl">
            <Link href="/dashboard/backtest">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to lab
            </Link>
          </Button>
        }
      />

      {error ? (
        <Card className="rounded-3xl border-red-400/20 bg-red-400/10">
          <CardContent className="p-5 text-sm text-red-200">{error}</CardContent>
        </Card>
      ) : null}

      {backtest ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[
            ["Initial", fmt(backtest.initial_balance)],
            ["Final", fmt(backtest.final_balance)],
            ["Win rate", `${fmt(backtest.win_rate)}%`],
            ["Trades", backtest.total_trades ?? 0],
          ].map(([label, value]) => (
            <Card key={label} className="rounded-3xl border-white/10 bg-[#0b1420]/84">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{label}</div>
                <div className="mt-3 text-2xl font-bold text-white">{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      <Card className="rounded-3xl border-white/10 bg-[#0b1420]/84">
        <div className="border-b border-white/10 px-5 py-4 text-sm font-semibold text-white">Equity</div>
        <CardContent className="p-5">
          <EquityChart data={equityData} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-3xl border-white/10 bg-white/[0.035]">
        <div className="border-b border-white/10 px-5 py-4 text-sm font-semibold text-white">Trades</div>
        <CardContent className="p-0">
          {!trades.length ? (
            <div className="p-6 text-sm text-slate-400">No trades stored.</div>
          ) : (
            <div className="overflow-auto">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Entry</th>
                    <th>SL</th>
                    <th>TP</th>
                    <th>Result</th>
                    <th>PnL</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade: any) => (
                    <tr key={trade.id}>
                      <td className={trade.type === "BUY" ? "buy-val" : "sell-val"}>{trade.type}</td>
                      <td>{fmt(trade.entry)}</td>
                      <td className="sell-val">{fmt(trade.sl)}</td>
                      <td className="buy-val">{fmt(trade.tp)}</td>
                      <td>{trade.result}</td>
                      <td className={Number(trade.pnl) >= 0 ? "pos" : "neg"}>{fmt(trade.pnl)}</td>
                      <td>{fmt(trade.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
