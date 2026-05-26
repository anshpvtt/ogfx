"use client";

import { simulateOrderBook } from "@/lib/cryptoPriceFeed";

export function PriceDepthChart({ price, symbol }: { price: number; symbol: string }) {
  const book = simulateOrderBook(price || 1, symbol);
  const max = Math.max(...book.bids.map((item) => item.size), ...book.asks.map((item) => item.size), 1);

  return (
    <div className="grid gap-2">
      <div className="arb-label">simulated depth</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          {book.bids.slice(0, 8).map((bid) => (
            <div key={bid.price} className="grid grid-cols-[1fr_76px] items-center gap-2 font-mono text-[11px] text-[#7ab88a]">
              <div className="h-2 rounded bg-[#00ff88]/15">
                <div className="h-full rounded bg-[#00ff88]/60" style={{ width: `${(bid.size / max) * 100}%` }} />
              </div>
              <span>{bid.price.toFixed(price > 100 ? 2 : 5)}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {book.asks.slice(0, 8).map((ask) => (
            <div key={ask.price} className="grid grid-cols-[76px_1fr] items-center gap-2 font-mono text-[11px] text-[#7ab88a]">
              <span>{ask.price.toFixed(price > 100 ? 2 : 5)}</span>
              <div className="h-2 rounded bg-[#ff4455]/15">
                <div className="h-full rounded bg-[#ff4455]/60" style={{ width: `${(ask.size / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
