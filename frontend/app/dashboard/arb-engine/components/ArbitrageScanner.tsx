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
    <section className="arb-panel min-h-[540px] p-5">
      <div className="flex flex-col gap-3 border-b border-[#164e63] pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.28em] text-[#22d3ee]">
            <Radar className="h-4 w-4" />
            Arbitrage scanner
          </div>
          <h2 className="mt-2 font-mono text-xl font-black text-[#eafbff] sm:text-2xl">
            SCANNING 15 ASSETS x 5 EXCHANGES = {pricePointCount || 75} PRICE POINTS
          </h2>
        </div>
        <div className="font-mono text-sm text-[#83afc2]">
          <span className="arb-dot mr-2 inline-block h-2.5 w-2.5 rounded-full bg-[#22d3ee]" />
          LIVE LOOP / 650MS
        </div>
      </div>

      <div className="mt-4 hidden grid-cols-[1.35fr_0.7fr_0.85fr_1fr_0.7fr_0.85fr_0.75fr] gap-3 border-b border-[#164e63]/80 pb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#31586a] xl:grid">
        <span>Pair</span>
        <span>Spread</span>
        <span>Est. profit / $1k</span>
        <span>Confidence</span>
        <span>Window</span>
        <span>Exchanges</span>
        <span className="text-right">Action</span>
      </div>

      <div className="mt-3 space-y-2">
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
          <div className="grid min-h-[320px] place-items-center rounded border border-[#164e63] bg-black/20 p-8 text-center font-mono text-[#31586a]">
            NO ARB GAPS FOUND - MARKET IS EFFICIENT RIGHT NOW
          </div>
        )}
      </div>
    </section>
  );
}
