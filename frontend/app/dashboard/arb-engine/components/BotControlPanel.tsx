"use client";

import { Power } from "lucide-react";
import { COINS } from "@/lib/cryptoPriceFeed";
import type { BotConfig, RiskMode } from "@/lib/arbTypes";

export function BotControlPanel({
  config,
  setConfig,
  running,
  tradesToday,
  winRate,
  bestTrade,
  onStart,
  onStop,
}: {
  config: BotConfig;
  setConfig: (config: BotConfig) => void;
  running: boolean;
  tradesToday: number;
  winRate: number;
  bestTrade: number;
  onStart: () => void;
  onStop: () => void;
}) {
  const safeMaxOpenTrades = Math.min(12, Math.max(1, Number(config.maxOpenTrades) || 8));
  const safeMinSpread = Math.min(5, Math.max(0.05, Number(config.minSpreadPct) || 0.12));

  function patch(next: Partial<BotConfig>) {
    setConfig({ ...config, ...next });
  }

  function toggleCoin(coinId: string) {
    const current = config.targetCoins.includes("ALL") ? [] : config.targetCoins;
    const next = current.includes(coinId) ? current.filter((item) => item !== coinId) : [...current, coinId];
    patch({ targetCoins: next.length ? next : ["ALL"] });
  }

  return (
    <section className="arb-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="arb-label">auto arb bot</div>
          <h3 className="font-mono text-xl font-black text-[#e0ffe8]">EXECUTION ENGINE</h3>
        </div>
        <button
          type="button"
          onClick={running ? onStop : onStart}
          className={[
            "grid h-14 w-14 place-items-center rounded border font-mono transition",
            running
              ? "arb-pulse border-[#22d3ee]/70 bg-[#22d3ee]/20 text-[#22d3ee]"
              : "border-[#164e63] bg-black/30 text-[#83afc2] hover:border-[#22d3ee]/50 hover:text-[#22d3ee]",
          ].join(" ")}
          aria-label={running ? "Stop bot" : "Start bot"}
        >
          <Power className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 rounded border border-[#164e63] bg-black/25 p-3 font-mono text-xs text-[#83afc2]">
        {running ? <span className="text-[#22d3ee]">BOT ACTIVE * AUTO-ROUTING...</span> : "BOT IDLE | POWER TO AUTO-RUN"}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <span>Trades {tradesToday}</span>
          <span>Win {winRate.toFixed(0)}%</span>
          <span>Best ${bestTrade.toFixed(4)}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        <label className="arb-field">
          Starting capital
          <input type="number" min={1} max={10000} value={config.startingCapital} onChange={(event) => patch({ startingCapital: Number(event.target.value) })} />
        </label>
        <label className="arb-field">
          Min spread %
          <input type="number" min={0.05} step={0.01} value={safeMinSpread} onChange={(event) => patch({ minSpreadPct: Math.min(5, Math.max(0.05, Number(event.target.value) || 0.12)) })} />
        </label>
        <label className="arb-field">
          Max simultaneous trades
          <input type="number" min={1} max={12} value={safeMaxOpenTrades} onChange={(event) => patch({ maxOpenTrades: Math.min(12, Math.max(1, Number(event.target.value) || 8)) })} />
        </label>
        <div>
          <div className="arb-label mb-2">Risk mode</div>
          <div className="grid grid-cols-3 gap-2">
            {(["conservative", "moderate", "aggressive"] as RiskMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => patch({ riskMode: mode })}
                className={`rounded border px-2 py-2 font-mono text-[11px] uppercase ${config.riskMode === mode ? "border-[#00ff88]/50 bg-[#00ff88]/15 text-[#00ff88]" : "border-[#004d26] text-[#7ab88a]"}`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="arb-label mb-2">Target coins</div>
          <div className="grid max-h-36 grid-cols-3 gap-2 overflow-y-auto pr-1">
            {COINS.map((coin) => {
              const checked = config.targetCoins.includes("ALL") || config.targetCoins.includes(coin.id);
              return (
                <button
                  key={coin.id}
                  type="button"
                  onClick={() => toggleCoin(coin.id)}
                  className={`rounded border px-2 py-1.5 font-mono text-[11px] ${checked ? "border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88]" : "border-[#004d26] text-[#2d5c3a]"}`}
                >
                  {coin.symbol}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
