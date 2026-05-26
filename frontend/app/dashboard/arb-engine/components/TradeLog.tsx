"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { PaperTrade } from "@/lib/arbTypes";

type Tab = "open" | "closed" | "all";

function money(value?: number) {
  const numeric = Number(value || 0);
  return `$${Math.abs(numeric) < 10 ? numeric.toFixed(4) : numeric.toFixed(2)}`;
}

export function TradeLog({ trades }: { trades: PaperTrade[] }) {
  const [tab, setTab] = useState<Tab>("open");
  const filtered = useMemo(() => {
    const rows = tab === "all" ? trades : trades.filter((trade) => trade.status === tab);
    return rows.slice(0, 40);
  }, [tab, trades]);
  const open = trades.filter((trade) => trade.status === "open").length;
  const closed = trades.filter((trade) => trade.status === "closed").length;
  const now = Date.now();

  function exportCsv() {
    const header = ["time", "coin", "buy_exchange", "sell_exchange", "size", "capital", "pnl", "pnl_pct", "status"];
    const rows = trades.map((trade) => [
      new Date(trade.entryTime).toISOString(),
      trade.coin,
      trade.buyExchange,
      trade.sellExchange,
      trade.size,
      trade.capitalUsed,
      trade.pnl ?? "",
      trade.pnlPct ?? "",
      trade.status,
    ]);
    const csv = [header, ...rows].map((row) => row.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ogfx-arb-trades.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="arb-panel p-5">
      <div className="flex flex-col gap-3 border-b border-[#004d26] pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="arb-label">trade log</div>
          <h3 className="font-mono text-xl font-black text-[#e0ffe8]">REAL-TIME FILLS</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-[#00ff88]/30 bg-[#00ff88]/10 px-3 py-1 font-mono text-xs text-[#00ff88]">Lite sync</span>
          <button type="button" onClick={exportCsv} className="inline-flex items-center gap-2 rounded border border-[#004d26] px-3 py-1.5 font-mono text-xs text-[#7ab88a] hover:text-[#00ff88]">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        {([
          ["open", `OPEN [${open}]`],
          ["closed", `CLOSED [${closed}]`],
          ["all", `ALL [${trades.length}]`],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded border px-3 py-2 font-mono text-xs ${tab === key ? "border-[#00ff88]/50 bg-[#00ff88]/15 text-[#00ff88]" : "border-[#004d26] text-[#7ab88a]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 max-h-[240px] overflow-auto">
        <table className="w-full min-w-[920px] font-mono text-xs">
          <thead className="sticky top-0 bg-[#020c07] text-[#2d5c3a]">
            <tr>
              {["Time", "Coin", "Buy @", "Sell @", "Size", "Capital", "P&L", "P&L%", "Status"].map((head) => (
                <th key={head} className="border-b border-[#004d26] px-3 py-2 text-left">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((trade) => {
              const fresh = now - (trade.exitTime || trade.entryTime) < 6500;
              const pnl = Number(trade.pnl || 0);
              return (
                <tr key={trade.id} className={`border-b border-[#004d26]/70 text-[#e0ffe8] ${fresh ? pnl < 0 ? "arb-row-loss" : "arb-row-profit" : ""}`}>
                  <td className="px-3 py-2 text-[#7ab88a]">{new Date(trade.entryTime).toLocaleTimeString()}</td>
                  <td className="px-3 py-2">{trade.coin}</td>
                  <td className="px-3 py-2">{trade.buyExchange} {money(trade.buyPrice)}</td>
                  <td className="px-3 py-2">{trade.sellExchange} {money(trade.sellPrice)}</td>
                  <td className="px-3 py-2">{trade.size.toFixed(8)}</td>
                  <td className="px-3 py-2">{money(trade.capitalUsed)}</td>
                  <td className={`px-3 py-2 ${pnl >= 0 ? "text-[#00ff88]" : "text-[#ff4455]"}`}>{trade.pnl == null ? "-" : money(trade.pnl)}</td>
                  <td className={`px-3 py-2 ${Number(trade.pnlPct || 0) >= 0 ? "text-[#00ff88]" : "text-[#ff4455]"}`}>{trade.pnlPct == null ? "-" : `${trade.pnlPct.toFixed(3)}%`}</td>
                  <td className="px-3 py-2 uppercase text-[#ffaa00]">{trade.status}</td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-[#2d5c3a]">NO TRADES LOGGED</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
