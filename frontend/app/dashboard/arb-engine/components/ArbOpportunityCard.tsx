"use client";

import { Play, Timer } from "lucide-react";
import { opportunityAgeLeft } from "@/lib/arbEngine";
import type { ArbOpportunity } from "@/lib/arbTypes";

function money(value: number) {
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(5)}`;
}

function exchangeCode(exchange: string) {
  return exchange.slice(0, 2).toUpperCase();
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
    <article className="arb-op-row">
      <button type="button" onClick={() => onInspect(opportunity.coinId)} className="min-w-0 text-left">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-[#00ff88]/30 bg-[#00ff88]/10 font-mono text-[11px] font-black text-[#00ff88] shadow-[0_0_18px_rgba(0,255,136,0.16)]">
            {opportunity.coin}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-mono text-sm font-black text-[#e0ffe8]">{opportunity.coin}/USDT</span>
            <span className="block truncate font-mono text-[11px] text-[#7ab88a]">
              {money(opportunity.buyPrice)} {"->"} {money(opportunity.sellPrice)}
            </span>
          </span>
        </div>
      </button>

      <div>
        <div className="arb-mobile-label">Spread</div>
        <div className="arb-live font-mono text-sm font-black text-[#00ff88]">+{opportunity.spreadPercent.toFixed(3)}%</div>
      </div>

      <div>
        <div className="arb-mobile-label">Est. profit</div>
        <div className="arb-live font-mono text-sm font-black text-[#00ff88]">+{money(opportunity.estimatedProfitPer1000)}</div>
      </div>

      <div>
        <div className="arb-mobile-label">Confidence</div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-black text-[#e0ffe8]">{opportunity.confidence}%</span>
          <span className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-[#003d20]">
            <span className="block h-full rounded-full bg-[#00ff88] shadow-[0_0_14px_rgba(0,255,136,0.55)]" style={{ width: `${opportunity.confidence}%` }} />
          </span>
        </div>
      </div>

      <div className="inline-flex items-center gap-1 font-mono text-sm text-[#e0ffe8]">
        <Timer className="h-3.5 w-3.5 text-[#ffaa00]" />
        ~{seconds}s
      </div>

      <div className="flex items-center gap-1.5">
        <span className="arb-exchange-chip">{exchangeCode(opportunity.buyExchange)}</span>
        <span className="text-[#2d5c3a]">{"->"}</span>
        <span className="arb-exchange-chip">{exchangeCode(opportunity.sellExchange)}</span>
      </div>

      <button
        type="button"
        onClick={() => onTrade(opportunity)}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded border border-[#00ff88]/40 bg-[#00ff88]/15 px-3 font-mono text-[11px] font-black uppercase tracking-[0.16em] text-[#00ff88] shadow-[0_0_20px_rgba(0,255,136,0.12)] transition hover:bg-[#00ff88]/25"
      >
        Trade <Play className="h-3.5 w-3.5" />
      </button>
    </article>
  );
}
