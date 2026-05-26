"use client";

import type { CoinMarket } from "@/lib/arbTypes";

function fmt(value: number) {
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(5)}`;
}

export function CryptoTickerBar({ markets, onSelect }: { markets: CoinMarket[]; onSelect: (coinId: string) => void }) {
  const doubled = [...markets, ...markets];

  return (
    <div className="arb-panel overflow-hidden px-0 py-3">
      {doubled.length ? (
        <div className="arb-marquee flex w-max gap-4">
          {doubled.map((coin, index) => {
            const up = Number(coin.change24h) >= 0;
            return (
              <button
                key={`${coin.id}-${index}`}
                type="button"
                onClick={() => onSelect(coin.id)}
                className="inline-flex items-center gap-2 border-r border-[#004d26] px-5 font-mono text-sm"
              >
                <span className="font-black text-[#e0ffe8]">{coin.symbol}</span>
                <span className="arb-live text-[#00ff88]">{fmt(coin.price)}</span>
                <span className={up ? "text-[#00ff88]" : "text-[#ff4455]"}>
                  {up ? "+" : "-"} {Math.abs(coin.change24h || 0).toFixed(2)}%
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="px-5 font-mono text-xs uppercase tracking-[0.24em] text-[#2d5c3a]">Initializing price feed...</div>
      )}
    </div>
  );
}
