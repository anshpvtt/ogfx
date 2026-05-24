"use client";

import { Fragment, useEffect, useState } from "react";
import { Activity, ChevronDown, ChevronRight, Loader2, Wallet } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { TRADING_ASSETS } from "@/lib/assets";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function DashboardHistoryPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pair, setPair] = useState("");
  const [loading, setLoading] = useState(true);
  const summaryCards = [
    { label: "Demo orders", value: orders.length, icon: Wallet },
    { label: "Open trades", value: orders.filter((order) => order.status === "OPEN").length, icon: Activity },
    { label: "Closed trades", value: orders.filter((order) => order.status !== "OPEN").length, icon: ChevronDown },
    { label: "Backtests", value: rows.length, icon: ChevronRight },
  ];

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function load() {
      setLoading(true);
      let query = supabase.from("backtests").select("*").order("created_at", { ascending: false });
      if (pair) query = query.eq("pair", pair);
      let orderQuery = supabase.from("demo_orders").select("*").order("opened_at", { ascending: false }).limit(100);
      if (pair) orderQuery = orderQuery.eq("asset_id", pair);
      const [{ data }, { data: orderData }] = await Promise.all([query, orderQuery]);
      setRows(data ?? []);
      setOrders(orderData ?? []);
      setLoading(false);
    }

    load();
  }, [pair]);

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Research memory"
        title="Trading history"
        description="Saved Supabase backtests plus demo terminal orders, filtered across the full OGFX asset universe."
        actions={
          <select
            value={pair}
            onChange={(event) => setPair(event.target.value)}
            className="h-11 rounded-xl border border-white/10 bg-[#0b1420] px-3 text-sm text-white outline-none transition-colors focus:border-cyan-300/40"
          >
            <option value="">All assets</option>
            {TRADING_ASSETS.map((item) => <option key={item.id}>{item.id}</option>)}
          </select>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        {summaryCards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
              <Icon className="h-4 w-4 text-cyan-200" />
              {label}
            </div>
            <div className="mt-2 text-2xl font-black text-white">{value}</div>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden rounded-3xl border-white/10 bg-[#0b1420]/84">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Wallet className="h-4 w-4 text-cyan-200" />
            Demo terminal orders
          </div>
          <span className="text-xs text-slate-500">Supabase synced</span>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-32 items-center justify-center text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading orders
            </div>
          ) : !orders.length ? (
            <div className="p-6 text-sm text-slate-400">No demo orders saved yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Opened</th>
                    <th>Asset</th>
                    <th>Side</th>
                    <th>Size</th>
                    <th>Entry</th>
                    <th>SL</th>
                    <th>TP</th>
                    <th>Status</th>
                    <th>PnL</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>{new Date(order.opened_at).toLocaleString()}</td>
                      <td className="sym">{order.asset_id}</td>
                      <td className={order.side === "BUY" ? "buy-val" : "sell-val"}>{order.side}</td>
                      <td>{order.size}</td>
                      <td>{order.entry}</td>
                      <td>{order.stop_loss}</td>
                      <td>{order.take_profit}</td>
                      <td>{order.status}</td>
                      <td className={(Number(order.pnl ?? 0)) >= 0 ? "pos" : "neg"}>{order.pnl ?? "-"}</td>
                      <td>{order.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-3xl border-white/10 bg-[#0b1420]/84">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="text-sm font-semibold text-white">Backtest runs</div>
          <span className="text-xs text-slate-500">Manual and cron records</span>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading history
            </div>
          ) : !rows.length ? (
            <div className="p-6 text-sm text-slate-400">No backtests saved yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Pair</th>
                    <th>Timeframe</th>
                    <th>Dates</th>
                    <th>Trades</th>
                    <th>Win rate</th>
                    <th>PF</th>
                    <th>Final</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Fragment key={row.id}>
                      <tr key={row.id} className="cursor-pointer" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                        <td>{expanded === row.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                        <td className="sym">{row.pair}</td>
                        <td>{row.timeframe}</td>
                        <td>{row.start_date} - {row.end_date}</td>
                        <td>{row.total_trades ?? 0}</td>
                        <td>{row.win_rate ?? 0}%</td>
                        <td>{row.profit_factor ?? 0}</td>
                        <td>{row.final_balance ?? 0}</td>
                      </tr>
                      {expanded === row.id ? (
                        <tr>
                          <td colSpan={8}>
                            <div className="max-h-72 overflow-auto rounded-2xl border border-white/10 bg-black/25 p-3">
                              {(row.trade_log ?? []).length ? (
                                <pre className="whitespace-pre-wrap text-xs text-slate-400">{JSON.stringify(row.trade_log, null, 2)}</pre>
                              ) : (
                                <div className="text-sm text-slate-400">No trades in this run.</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
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
