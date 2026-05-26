"use client";

import type { ExecutionTapeEvent, PaperTrade } from "@/lib/arbTypes";

function pnlText(trade: PaperTrade) {
  const pnl = Number(trade.pnl || 0);
  return `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)}`;
}

export function PaperTradeBot({
  trades,
  running,
  events,
}: {
  trades: PaperTrade[];
  running: boolean;
  events: ExecutionTapeEvent[];
}) {
  const latest = trades.slice(0, 4);
  const heroEvent = events[0];

  return (
    <section className="arb-panel overflow-hidden p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="arb-label">execution tape</div>
          <h3 className="font-mono text-lg font-black text-[#e0ffe8]">{running ? "LIVE ROUTER" : "STANDBY"} <span className="arb-cursor">|</span></h3>
        </div>
        <span className={running ? "arb-dot h-3 w-3 rounded-full bg-[#00ff88]" : "h-3 w-3 rounded-full bg-[#004d26]"} />
      </div>

      <div className="mt-4 min-h-[84px]">
        {heroEvent ? (
          <div className={`arb-event-hero arb-event-${heroEvent.tone}`}>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#7ab88a]">{heroEvent.title}</div>
            <div className="mt-2 font-mono text-xl font-black text-[#e0ffe8]">{heroEvent.message}</div>
            <div className="mt-2 font-mono text-[11px] text-[#2d5c3a]">
              {heroEvent.trade.buyExchange} {"->"} {heroEvent.trade.sellExchange}
            </div>
          </div>
        ) : (
          <div className="rounded border border-[#004d26] bg-black/20 p-4 font-mono text-xs text-[#2d5c3a]">
            Awaiting qualifying spreads...
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {(events.length ? events.slice(0, 4) : latest.map((trade) => ({
          id: trade.id,
          tone: trade.status === "open" ? "entry" : Number(trade.pnl || 0) >= 0 ? "profit" : "loss",
          title: trade.status === "open" ? "ENTRY LOCKED" : Number(trade.pnl || 0) >= 0 ? "CLOSED PROFIT" : "CLOSED LOSS",
          message: trade.status === "open" ? `${trade.coin} route active` : `${trade.coin} ${pnlText(trade)}`,
          trade,
        }))).map((event) => (
          <div key={event.id} className={`arb-event-row arb-event-${event.tone}`}>
            <div className="flex justify-between gap-2">
              <span className="text-[#e0ffe8]">{event.title}</span>
              <span className={event.tone === "loss" ? "text-[#ff4455]" : "text-[#00ff88]"}>{event.message}</span>
            </div>
            <div className="mt-1 truncate text-[#2d5c3a]">{event.trade.reason}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
