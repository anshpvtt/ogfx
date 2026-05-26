"use client";

import { Radar } from "lucide-react";
import { ArbOpportunityCard } from "./ArbOpportunityCard";
import type { ArbOpportunity } from "@/lib/arbTypes";

export function ArbitrageScanner({
  opportunities,
  pricePointCount,
  now,
  onTrade,
  onInspect,
}: {
  opportunities: ArbOpportunity[];
  pricePointCount: number;
  now: number;
  onTrade: (opportunity: ArbOpportunity) => void;
  onInspect: (coinId: string) => void;
}) {
  return (
    <section className="arb-panel min-h-[620px] p-5">
      <div className="flex flex-col gap-3 border-b border-[#004d26] pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.28em] text-[#00ff88]">
            <Radar className="h-4 w-4" />
            Arb Scanner
          </div>
          <h2 className="mt-2 font-mono text-2xl font-black text-[#e0ffe8]">
            SCANNING 15 ASSETS × 5 EXCHANGES = {pricePointCount || 75} PRICE POINTS
          </h2>
        </div>
        <div className="font-mono text-sm text-[#7ab88a]">
          <span className="arb-dot mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#00ff88]" />
          LIVE LOOP / 1000MS
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {opportunities.length ? (
          opportunities.map((opportunity) => (
            <ArbOpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              now={now}
              onTrade={onTrade}
              onInspect={onInspect}
            />
          ))
        ) : (
          <div className="grid min-h-[360px] place-items-center rounded border border-[#004d26] bg-black/20 p-8 text-center font-mono text-[#2d5c3a]">
            NO ARB GAPS FOUND — MARKET IS EFFICIENT RIGHT NOW
          </div>
        )}
      </div>
    </section>
  );
}
