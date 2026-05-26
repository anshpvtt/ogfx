"use client";

import type { PaperTrade } from "@/lib/arbTypes";
import { paperStats } from "@/lib/paperBroker";

export function PnLTracker({ capital, startingCapital, trades }: { capital: number; startingCapital: number; trades: PaperTrade[] }) {
  const stats = paperStats(trades, capital, startingCapital);
  const positive = stats.totalReturn >= 0;

  return (
    <section className="arb-panel p-5">
      <div className="arb-label">paper p&l</div>
      <div className={`arb-live mt-3 font-mono text-4xl font-black ${positive ? "text-[#00ff88]" : "text-[#ff4455]"}`}>
        ${capital.toFixed(2)}
      </div>
      <div className="mt-1 font-mono text-xs text-[#7ab88a]">Starting capital ${startingCapital.toFixed(2)}</div>

      <div className="mt-5 grid grid-cols-2 gap-3 font-mono text-xs">
        <div className="rounded border border-[#004d26] bg-black/25 p-3">
          <div className="text-[#2d5c3a]">Total return</div>
          <div className={positive ? "text-[#00ff88]" : "text-[#ff4455]"}>
            {positive ? "+" : ""}${stats.totalReturn.toFixed(2)} ({positive ? "+" : ""}{stats.totalReturnPct.toFixed(2)}%)
          </div>
        </div>
        <div className="rounded border border-[#004d26] bg-black/25 p-3">
          <div className="text-[#2d5c3a]">Trades</div>
          <div className="text-[#e0ffe8]">Won {stats.won} / Lost {stats.lost}</div>
        </div>
        <div className="rounded border border-[#004d26] bg-black/25 p-3">
          <div className="text-[#2d5c3a]">Best trade</div>
          <div className="text-[#00ff88]">${stats.bestTrade.toFixed(2)}</div>
        </div>
        <div className="rounded border border-[#004d26] bg-black/25 p-3">
          <div className="text-[#2d5c3a]">Worst trade</div>
          <div className="text-[#ff4455]">${stats.worstTrade.toFixed(2)}</div>
        </div>
      </div>
    </section>
  );
}
