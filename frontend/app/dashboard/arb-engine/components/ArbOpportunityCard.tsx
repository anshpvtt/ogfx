"use client";

import { Play, Timer } from "lucide-react";
import { opportunityAgeLeft } from "@/lib/arbEngine";
import type { ArbOpportunity } from "@/lib/arbTypes";

function money(value: number) {
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(5)}`;
}

export function ArbOpportunityCard({
  opportunity,
  now,
  onTrade,
  onInspect,
}: {
  opportunity: ArbOpportunity;
  now: number;
  onTrade: (opportunity: ArbOpportunity) => void;
  onInspect: (coinId: string) => void;
}) {
  const left = opportunityAgeLeft(opportunity, now);
  const seconds = Math.ceil(left / 1000);

  return (
    <article className="arb-panel group relative overflow-hidden p-4">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#00ff88] to-transparent opacity-40" />
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <button type="button" onClick={() => onInspect(opportunity.coinId)} className="flex min-w-0 items-center gap-3 text-left">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded border border-[#00ff88]/30 bg-[#00ff88]/10 font-mono text-sm font-black text-[#00ff88] shadow-[0_0_18px_rgba(0,255,136,0.2)]">
            {opportunity.coin}
          </div>
          <div className="min-w-0">
            <div className="font-mono text-xs uppercase tracking-[0.26em] text-[#7ab88a]">arb route</div>
            <div className="truncate font-mono text-sm text-[#e0ffe8]">
              BUY {opportunity.buyExchange} @ {money(opportunity.buyPrice)} <span className="text-[#2d5c3a]">→</span> SELL {opportunity.sellExchange} @ {money(opportunity.sellPrice)}
            </div>
          </div>
        </button>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[500px]">
          <div>
            <div className="arb-label">spread</div>
            <div className="arb-live text-xl text-[#ffaa00]">+{opportunity.spreadPercent.toFixed(3)}%</div>
          </div>
          <div>
            <div className="arb-label">est / $1k</div>
            <div className="arb-live text-xl text-[#00ff88]">+{money(opportunity.estimatedProfitPer1000)}</div>
          </div>
          <div>
            <div className="arb-label">confidence</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#003d20]">
              <div className="h-full rounded-full bg-[#00ff88] shadow-[0_0_14px_rgba(0,255,136,0.55)]" style={{ width: `${opportunity.confidence}%` }} />
            </div>
            <div className="mt-1 font-mono text-xs text-[#7ab88a]">{opportunity.confidence}%</div>
          </div>
          <div>
            <div className="arb-label">window</div>
            <div className="mt-1 inline-flex items-center gap-1 font-mono text-sm text-[#e0ffe8]">
              <Timer className="h-3.5 w-3.5 text-[#ffaa00]" />
              ~{seconds}s
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onTrade(opportunity)}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded border border-[#00ff88]/40 bg-[#00ff88]/15 px-4 font-mono text-xs font-black uppercase tracking-[0.18em] text-[#00ff88] shadow-[0_0_20px_rgba(0,255,136,0.16)] transition hover:bg-[#00ff88]/25"
        >
          Paper trade <Play className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}
