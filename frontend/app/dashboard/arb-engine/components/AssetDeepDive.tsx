"use client";

import { X } from "lucide-react";
import { COINS } from "@/lib/cryptoPriceFeed";
import type { CoinMarket, ExchangePrice } from "@/lib/arbTypes";
import { PriceDepthChart } from "./PriceDepthChart";

function money(value: number) {
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(5)}`;
}

export function AssetDeepDive({
  coinId,
  markets,
  exchangePrices,
  onClose,
}: {
  coinId: string | null;
  markets: CoinMarket[];
  exchangePrices: ExchangePrice[];
  onClose: () => void;
}) {
  if (!coinId) return null;
  const coin = markets.find((item) => item.id === coinId) || COINS.find((item) => item.id === coinId);
  if (!coin) return null;
  const rows = exchangePrices.filter((item) => item.coinId === coinId);
  const market = markets.find((item) => item.id === coinId);
  const best = [...rows].sort((left, right) => right.bid - left.ask)[0];
  const price = market?.price || rows[0]?.price || 1;
  const tvSymbol = encodeURIComponent(coin.tradingViewSymbol);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4 backdrop-blur-sm">
      <div className="arb-panel mx-auto flex max-h-[92vh] max-w-6xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#004d26] p-5">
          <div>
            <div className="arb-label">asset deep dive</div>
            <h2 className="font-mono text-2xl font-black text-[#e0ffe8]">{coin.symbol} / {coin.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded border border-[#004d26] text-[#7ab88a] hover:text-[#00ff88]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="arb-panel p-4"><div className="arb-label">last</div><div className="arb-live text-xl text-[#00ff88]">{money(price)}</div></div>
              <div className="arb-panel p-4"><div className="arb-label">24h change</div><div className={Number(market?.change24h) >= 0 ? "text-[#00ff88]" : "text-[#ff4455]"}>{(market?.change24h || 0).toFixed(2)}%</div></div>
              <div className="arb-panel p-4"><div className="arb-label">24h vol</div><div className="text-[#e0ffe8]">{market?.volume24h ? money(market.volume24h) : "SIM"}</div></div>
              <div className="arb-panel p-4"><div className="arb-label">market cap</div><div className="text-[#e0ffe8]">{market?.marketCap ? money(market.marketCap) : "SIM"}</div></div>
            </div>
            <div className="arb-panel p-4">
              <div className="arb-label mb-3">price across exchanges</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] font-mono text-xs">
                  <thead className="text-[#2d5c3a]">
                    <tr><th className="py-2 text-left">Exchange</th><th className="text-right">Bid</th><th className="text-right">Ask</th><th className="text-right">Spread</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.exchange} className="border-t border-[#004d26] text-[#e0ffe8]">
                        <td className="py-2">{row.exchange}</td>
                        <td className="text-right text-[#00ff88]">{money(row.bid)}</td>
                        <td className="text-right text-[#ffaa00]">{money(row.ask)}</td>
                        <td className="text-right">{row.spread.toFixed(3)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="arb-panel overflow-hidden p-4">
              <div className="arb-label mb-3">TradingView mini chart</div>
              <iframe
                title={`${coin.symbol} TradingView chart`}
                src={`https://s.tradingview.com/widgetembed/?symbol=${tvSymbol}&interval=15&theme=dark&style=1`}
                className="h-[360px] w-full border-0"
              />
            </div>
          </div>
          <div className="space-y-5">
            <div className="arb-panel p-4">
              <PriceDepthChart price={price} symbol={coin.symbol} />
            </div>
            <div className="arb-panel p-4 font-mono text-sm">
              <div className="arb-label mb-3">historical arb frequency</div>
              <div className="text-[#e0ffe8]">{Math.round((coin.liquidityRank / 100) * 46 + rows.length * 2)} gaps today</div>
            </div>
            <div className="arb-panel p-4 font-mono text-sm">
              <div className="arb-label mb-3">best exchange pair</div>
              <div className="text-[#ffaa00]">{best ? `${best.exchange} liquidity lead` : "Waiting for feed"}</div>
            </div>
            <div className="rounded border border-[#ffaa00]/25 bg-[#ffaa00]/10 p-4 font-mono text-xs leading-5 text-[#ffd27a]">
              Sandbox route model. Real arbitrage requires exchange balances, withdrawal constraints, fees, latency, and execution controls.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
