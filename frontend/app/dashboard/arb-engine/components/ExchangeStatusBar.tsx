"use client";

import { Settings } from "lucide-react";
import { EXCHANGES_SIMULATED } from "@/lib/cryptoPriceFeed";

export function ExchangeStatusBar({ onSettings }: { onSettings?: () => void }) {
  return (
    <section className="arb-panel p-5">
      <div className="flex items-center justify-between">
        <div className="arb-label">exchange links</div>
        <button type="button" onClick={onSettings} className="text-[#7ab88a] hover:text-[#00ff88]" aria-label="Open exchange settings">
          <Settings className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        {EXCHANGES_SIMULATED.map((exchange) => (
          <div key={exchange} className="flex items-center justify-between rounded border border-[#004d26] bg-black/25 px-3 py-2 font-mono text-xs">
            <span className="text-[#e0ffe8]">{exchange}</span>
            <span className="text-[#ffaa00]">[SIMULATED]</span>
          </div>
        ))}
      </div>
    </section>
  );
}
