"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, Cpu, Maximize2, Minimize2, RadioTower, Terminal, Zap } from "lucide-react";
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
    reason: String(row.reason || "Synced route"),
  };
}

function capitalDisplay(value: number) {
  if (value >= 100000) return value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (value >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

export default function ArbEnginePage() {
  const scanner = useArbScanner();
  const bot = usePaperBot(scanner.opportunities);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const arbRootRef = useRef<HTMLDivElement | null>(null);

  const assets = scanner.feed?.markets.length || 15;
  const exchanges = scanner.feed?.exchangePrices.length
    ? new Set(scanner.feed.exchangePrices.map((price) => price.exchange)).size
    : 5;
  const scans = scanner.pricePointCount || assets * exchanges;
  const positive = bot.stats.totalReturn >= 0;

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
  }, [bot.hydrateHistory, historyLoaded]);

  useEffect(() => {
    function syncFullscreen() {
      setIsFullscreen(document.fullscreenElement === arbRootRef.current);
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await arbRootRef.current?.requestFullscreen();
      }
    } catch {
      setIsFullscreen((current) => !current);
    }
  }

  return (
    <div ref={arbRootRef} className={`arb-root -m-4 min-h-screen p-3 sm:-m-6 sm:p-5 lg:-m-8 lg:p-6 ${isFullscreen ? "arb-fullscreen-mode" : ""}`}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 arb-scanlines" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1760px] space-y-4">
        <CryptoTickerBar markets={scanner.feed?.markets ?? []} onSelect={setSelectedCoin} />

        <header className="arb-console-head">
          <div className="arb-capital-core">
            <div className="flex items-center justify-between gap-3">
              <div className="arb-label">live capital</div>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="arb-ecosystem-button"
                aria-label={isFullscreen ? "Exit fullscreen Arb ecosystem" : "Enter fullscreen Arb ecosystem"}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen ecosystem"}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                <span>{isFullscreen ? "EXIT" : "ECOSYSTEM"}</span>
              </button>
            </div>
            <div className={`arb-capital-number ${positive ? "text-[#00ff88]" : "text-[#ff4455]"}`}>
              ${capitalDisplay(bot.state.capital)}
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-[#7ab88a]">
              <span>START ${bot.state.startingCapital.toFixed(2)}</span>
              <span className={positive ? "text-[#00ff88]" : "text-[#ff4455]"}>
                {positive ? "+" : ""}{bot.stats.totalReturnPct.toFixed(2)}%
              </span>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs uppercase tracking-[0.22em] text-[#00ff88]">
              <span className="inline-flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                OGFX / CRYPTO ARBITRAGE
              </span>
              <span className="rounded border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-2 py-1 text-[10px] tracking-[0.18em] text-[#8aebff]">
                OPERATIONAL
              </span>
            </div>
            <h1 className="arb-title mt-2 font-mono text-4xl font-black tracking-tight text-[#eafbff] sm:text-5xl">
              ARB ENGINE<span className="arb-cursor ml-2">|</span>
            </h1>
            <div className="mt-3 grid gap-2 font-mono text-xs text-[#7ab88a] sm:grid-cols-3">
              <div className="arb-mini-stat"><span>FEED</span><strong>{scanner.feed?.source === "coingecko" ? "COINGECKO LIVE" : "FALLBACK SIM"}</strong></div>
              <div className="arb-mini-stat"><span>LOOP</span><strong>0.650s</strong></div>
              <div className="arb-mini-stat"><span>STATUS</span><strong>{bot.state.isRunning ? "AUTO-ROUTING" : "SCANNING"}</strong></div>
            </div>
          </div>

          <div className="arb-system-card">
            <div className="flex items-center justify-between">
              <div className="arb-label">system status</div>
              <span className="arb-dot h-2.5 w-2.5 rounded-full bg-[#00ff88]" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
              <div><span className="text-[#2d5c3a]">Trades</span><strong className="block text-[#e0ffe8]">{bot.closedTrades.length}</strong></div>
              <div><span className="text-[#2d5c3a]">Win rate</span><strong className="block text-[#00ff88]">{bot.stats.winRate.toFixed(0)}%</strong></div>
              <div><span className="text-[#2d5c3a]">Best</span><strong className="block text-[#00ff88]">${bot.stats.bestTrade.toFixed(4)}</strong></div>
              <div><span className="text-[#31586a]">Open</span><strong className="block text-[#ffb020]">{bot.openTrades.length}</strong></div>
            </div>
          </div>
        </header>

        {(scanner.error || scanner.feed?.warning) ? (
          <div className="arb-panel flex items-start gap-3 border-[#ffaa00]/30 bg-[#ffaa00]/10 p-4 font-mono text-xs text-[#ffd27a]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {scanner.error || scanner.feed?.warning}
          </div>
        ) : null}

        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="space-y-4">
            <section className="arb-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="arb-label">market overview</div>
                <span className="font-mono text-[11px] text-[#00ff88]">LIVE MATRIX</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="arb-stat-card"><RadioTower className="h-4 w-4" /><span>Total assets</span><strong>{assets}</strong></div>
                <div className="arb-stat-card"><Cpu className="h-4 w-4" /><span>Exchanges</span><strong>{exchanges}</strong></div>
                <div className="arb-stat-card"><Activity className="h-4 w-4" /><span>Pair scans</span><strong>{scans}</strong></div>
                <div className="arb-stat-card"><Zap className="h-4 w-4" /><span>Opportunities</span><strong>{scanner.opportunities.length}</strong></div>
              </div>
              <div className="arb-sparkline mt-4" aria-hidden="true">
                {Array.from({ length: 26 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 17 + scans) % 58)}%` }} />)}
              </div>
            </section>

            <ArbitrageScanner
              opportunities={scanner.opportunities}
              pricePointCount={scanner.pricePointCount}
              now={scanner.tick}
              onTrade={bot.paperTrade}
              onInspect={setSelectedCoin}
            />

            <TradeLog trades={bot.state.trades} />
          </main>

          <aside className="space-y-4">
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
            <PaperTradeBot trades={bot.state.trades} running={bot.state.isRunning} events={bot.recentEvents} />
            <ExchangeStatusBar onSettings={() => { window.location.href = "/dashboard/settings?tab=exchange"; }} />
          </aside>
        </div>

        <div className="arb-footer-line">
          <span>LAST SYNC {new Date(scanner.tick).toLocaleTimeString()}</span>
          <span>FEED LATENCY 120MS</span>
          <span>SUPABASE CONNECTED</span>
          <span>ENVIRONMENT SANDBOX</span>
        </div>
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
