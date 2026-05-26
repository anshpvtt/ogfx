"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Cpu, Terminal } from "lucide-react";
import { useArbScanner } from "@/hooks/useArbScanner";
import { usePaperBot } from "@/hooks/usePaperBot";
import type { PaperTrade } from "@/lib/arbTypes";
import { ArbitrageScanner } from "./components/ArbitrageScanner";
import { AssetDeepDive } from "./components/AssetDeepDive";
import { BotControlPanel } from "./components/BotControlPanel";
import { CapitalGrowthChart } from "./components/CapitalGrowthChart";
import { CryptoTickerBar } from "./components/CryptoTickerBar";
import { ExchangeStatusBar } from "./components/ExchangeStatusBar";
import { PaperTradeBot } from "./components/PaperTradeBot";
import { PnLTracker } from "./components/PnLTracker";
import { TradeLog } from "./components/TradeLog";

function mapDbTrade(row: any): PaperTrade {
  const entryTime = row.entry_time ? new Date(row.entry_time).getTime() : Date.now();
  const exitTime = row.exit_time ? new Date(row.exit_time).getTime() : undefined;
  return {
    id: String(row.client_trade_id || row.id),
    coin: String(row.coin),
    coinId: String(row.coin_id || row.coin || "").toLowerCase(),
    buyExchange: row.buy_exchange,
    sellExchange: row.sell_exchange,
    entryTime,
    exitTime,
    buyPrice: Number(row.buy_price),
    sellPrice: Number(row.sell_price),
    size: Number(row.size),
    capitalUsed: Number(row.capital_used),
    grossSpreadPct: Number(row.gross_spread_pct || 0),
    fees: Number(row.fees || 0),
    pnl: row.pnl == null ? undefined : Number(row.pnl),
    pnlPct: row.pnl_pct == null ? undefined : Number(row.pnl_pct),
    status: row.status,
    reason: String(row.reason || "Synced paper trade"),
  };
}

export default function ArbEnginePage() {
  const scanner = useArbScanner();
  const bot = usePaperBot(scanner.opportunities);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    async function loadHistory() {
      try {
        const response = await fetch("/api/arb/history", { cache: "no-store" });
        const payload = await response.json();
        if (response.ok && Array.isArray(payload.trades)) {
          bot.hydrateHistory(payload.trades.map(mapDbTrade));
        }
      } finally {
        setHistoryLoaded(true);
      }
    }
    if (!historyLoaded) loadHistory();
  }, [bot, historyLoaded]);

  return (
    <div className="arb-root -m-4 min-h-screen p-4 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 arb-scanlines" />
      </div>

      <div className="relative z-10 space-y-5">
        <header className="arb-panel overflow-hidden p-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-[#00ff88]">
                <Terminal className="h-4 w-4" />
                OGFX / CRYPTO_ARBITRAGE / PAPER_ONLY
              </div>
              <h1 className="mt-3 font-mono text-4xl font-black tracking-tight text-[#e0ffe8] sm:text-5xl">
                ARB ENGINE<span className="arb-cursor ml-2">▮</span>
              </h1>
              <p className="mt-3 max-w-3xl font-mono text-sm leading-6 text-[#7ab88a]">
                CoinGecko-backed price monitor with simulated exchange spreads, client-side paper execution, and Supabase-synced research logs. No real money is moved.
              </p>
            </div>
            <div className="grid gap-3 font-mono text-xs sm:grid-cols-3 xl:min-w-[520px]">
              <div className="rounded border border-[#004d26] bg-black/25 p-3"><span className="text-[#2d5c3a]">Feed</span><div className="text-[#00ff88]">{scanner.feed?.source === "coingecko" ? "COINGECKO LIVE" : "FALLBACK SIM"}</div></div>
              <div className="rounded border border-[#004d26] bg-black/25 p-3"><span className="text-[#2d5c3a]">Loop</span><div className="text-[#00ff88]">1.000s</div></div>
              <div className="rounded border border-[#004d26] bg-black/25 p-3"><span className="text-[#2d5c3a]">Mode</span><div className="text-[#ffaa00]">PAPER ONLY</div></div>
            </div>
          </div>
        </header>

        <CryptoTickerBar markets={scanner.feed?.markets ?? []} onSelect={setSelectedCoin} />

        {(scanner.error || scanner.feed?.warning) ? (
          <div className="arb-panel flex items-start gap-3 border-[#ffaa00]/30 bg-[#ffaa00]/10 p-4 font-mono text-xs text-[#ffd27a]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {scanner.error || scanner.feed?.warning}
          </div>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <ArbitrageScanner
            opportunities={scanner.opportunities}
            pricePointCount={scanner.pricePointCount}
            now={scanner.tick}
            onTrade={bot.paperTrade}
            onInspect={setSelectedCoin}
          />

          <aside className="space-y-5">
            <BotControlPanel
              config={bot.config}
              setConfig={bot.setConfig}
              running={bot.state.isRunning}
              tradesToday={bot.closedTrades.length}
              winRate={bot.stats.winRate}
              bestTrade={bot.stats.bestTrade}
              onStart={() => bot.start()}
              onStop={bot.stop}
            />
            <PnLTracker capital={bot.state.capital} startingCapital={bot.state.startingCapital} trades={bot.state.trades} />
            <CapitalGrowthChart snapshots={bot.state.snapshots} startingCapital={Math.max(1, bot.state.startingCapital)} />
            <PaperTradeBot trades={bot.state.trades} running={bot.state.isRunning} />
            <ExchangeStatusBar onSettings={() => { window.location.href = "/dashboard/settings?tab=exchange"; }} />
          </aside>
        </div>

        <div className="arb-panel flex items-start gap-3 border-[#ffaa00]/30 bg-[#ffaa00]/10 p-4 font-mono text-xs leading-5 text-[#ffd27a]">
          <Cpu className="mt-0.5 h-4 w-4 shrink-0" />
          Paper trading only. Real exchange execution is disabled until live mode is explicitly designed, reviewed, and connected with proper exchange API controls.
        </div>

        <TradeLog trades={bot.state.trades} />
      </div>

      <AssetDeepDive
        coinId={selectedCoin}
        markets={scanner.feed?.markets ?? []}
        exchangePrices={scanner.feed?.exchangePrices ?? []}
        onClose={() => setSelectedCoin(null)}
      />
    </div>
  );
}
