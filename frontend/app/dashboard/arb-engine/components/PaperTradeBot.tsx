"use client";

import type { PaperTrade } from "@/lib/arbTypes";

export function PaperTradeBot({ trades, running }: { trades: PaperTrade[]; running: boolean }) {
  const latest = trades.slice(0, 4);
  return (
    <section className="arb-panel p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="arb-label">paper bot tape</div>
          <h3 className="font-mono text-lg font-black text-[#e0ffe8]">{running ? "EXECUTING" : "STANDBY"} ▮</h3>
        </div>
        <span className={running ? "arb-dot h-3 w-3 rounded-full bg-[#00ff88]" : "h-3 w-3 rounded-full bg-[#004d26]"} />
      </div>
      <div className="mt-4 space-y-2">
        {latest.length ? latest.map((trade) => (
          <div key={trade.id} className="rounded border border-[#004d26] bg-black/25 p-3 font-mono text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-[#e0ffe8]">{trade.coin} {trade.buyExchange}→{trade.sellExchange}</span>
              <span className={trade.status === "open" ? "text-[#ffaa00]" : Number(trade.pnl || 0) >= 0 ? "text-[#00ff88]" : "text-[#ff4455]"}>
                {trade.status === "open" ? "OPEN" : `${Number(trade.pnl || 0) >= 0 ? "+" : ""}$${Number(trade.pnl || 0).toFixed(2)}`}
              </span>
            </div>
            <div className="mt-1 text-[#2d5c3a]">{trade.reason}</div>
          </div>
        )) : <div className="rounded border border-[#004d26] p-3 font-mono text-xs text-[#2d5c3a]">Awaiting qualifying spreads...</div>}
      </div>
    </section>
  );
}
