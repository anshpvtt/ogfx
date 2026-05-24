"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Crosshair,
  History,
  Layers3,
  Loader2,
  Lock,
  Maximize2,
  Minus,
  MousePointer2,
  PanelRight,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { LIVE_CHART_TIMEFRAMES, TRADING_ASSETS } from "@/lib/assets";
import { Button } from "@/components/ui/button";
import { backendJson, chartIntervalToApi } from "@/lib/backend-api";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const TradingViewAdvancedChart = dynamic(
  () => import("@/components/charts/TradingViewWidgets").then((mod) => mod.TradingViewAdvancedChart),
  { ssr: false }
);

type MarketSnapshot = {
  assetId: string;
  timeframe: string;
  latest: null | {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  dayChange: number;
  dayChangePct: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  atr: number;
};

type AgentDecision = {
  decision: "BUY" | "SELL" | "WAIT";
  confidence: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  bias: string;
  summary: string;
  reasons: string[];
  invalidation: string;
  model: string;
  mode: "gemma" | "openrouter" | "local-demo";
};

type DemoAccount = {
  currency: string;
  initial_balance: number;
  balance: number;
  equity: number;
  free_margin: number;
  margin: number;
  margin_level: number | null;
  realized_pnl: number;
  updated_at: string;
};

type DemoSettings = {
  auto_trading_enabled: boolean;
  risk_per_trade: number;
  max_open_trades: number;
  default_size: number;
  watched_assets: string[];
};

type DemoOrder = {
  id: string;
  asset_id: string;
  trading_view_symbol: string | null;
  side: "BUY" | "SELL";
  entry: number;
  stop_loss: number;
  take_profit: number;
  size: number;
  status: "OPEN" | "TP" | "SL" | "CLOSED";
  source: "manual" | "agent" | "agent-cron";
  strategy_name: string | null;
  confidence: number | null;
  reason: string | null;
  opened_at: string;
  closed_at: string | null;
  exit_price: number | null;
  pnl: number | null;
};

type BackendOrder = {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  lotSize: number;
  entry: number;
  sl: number;
  tp: number;
  status: "open" | "pending" | "closed";
  pnl: number | null;
  openedAt: string;
  closedAt: string | null;
  closePrice: number | null;
  raw?: Partial<DemoOrder>;
};

const DEFAULT_INTERVAL = LIVE_CHART_TIMEFRAMES[0];

function snapshotTimeframe(interval: string) {
  if (interval === "240") return "4H";
  if (interval === "D") return "1D";
  return "1H";
}

function formatPrice(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(Math.abs(Number(value)) > 20 ? 2 : 5);
}

function formatMoney(value: number | null | undefined, currency = "USD") {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function defaultLevels(side: "BUY" | "SELL", snapshot?: MarketSnapshot) {
  const close = Number(snapshot?.latest?.close ?? 0);
  const atr = Number(snapshot?.atr ?? 0);
  const distance = close ? (atr > 0 ? atr * 1.4 : close * 0.004) : 0;
  const target = distance * 2;

  return {
    entry: close ? formatPrice(close) : "",
    stopLoss: close ? formatPrice(side === "BUY" ? close - distance : close + distance) : "",
    takeProfit: close ? formatPrice(side === "BUY" ? close + target : close - target) : "",
  };
}

function toDemoOrder(order: BackendOrder | DemoOrder): DemoOrder {
  const raw = ("raw" in order ? order.raw ?? {} : order) as Partial<DemoOrder>;
  const status = "status" in order ? String(order.status).toLowerCase() : "open";
  return {
    id: order.id,
    asset_id: "asset_id" in order ? order.asset_id : order.symbol,
    trading_view_symbol: raw.trading_view_symbol ?? null,
    side: "side" in order ? order.side : order.direction,
    entry: "entry" in order ? Number(order.entry) : 0,
    stop_loss: "stop_loss" in order ? Number(order.stop_loss) : Number(order.sl),
    take_profit: "take_profit" in order ? Number(order.take_profit) : Number(order.tp),
    size: "size" in order ? Number(order.size) : Number(order.lotSize),
    status: status === "closed" ? "CLOSED" : status === "pending" ? "OPEN" : "OPEN",
    source: raw.source ?? "manual",
    strategy_name: raw.strategy_name ?? null,
    confidence: raw.confidence ?? null,
    reason: raw.reason ?? null,
    opened_at: "opened_at" in order ? order.opened_at : order.openedAt,
    closed_at: "closed_at" in order ? order.closed_at : order.closedAt,
    exit_price: raw.exit_price ?? ("closePrice" in order ? order.closePrice : null),
    pnl: order.pnl,
  };
}

function decisionFromSignalPayload(payload: any): AgentDecision {
  const gemma = payload.gemma ?? {};
  const analysis = payload.analysis ?? {};
  const direction = payload.confirmed && (gemma.direction === "BUY" || gemma.direction === "SELL")
    ? gemma.direction
    : "WAIT";
  const reason = gemma.reason || analysis.reason || "WAIT - Waiting for clean market snapshot";

  return {
    decision: direction,
    confidence: Number(gemma.confidence ?? analysis.confidence ?? 0),
    entry: Number.isFinite(Number(gemma.entry ?? analysis.entry)) ? Number(gemma.entry ?? analysis.entry) : null,
    stopLoss: Number.isFinite(Number(gemma.sl ?? analysis.sl)) ? Number(gemma.sl ?? analysis.sl) : null,
    takeProfit: Number.isFinite(Number(gemma.tp ?? analysis.tp)) ? Number(gemma.tp ?? analysis.tp) : null,
    riskReward: Number.isFinite(Number(analysis.rr)) ? Number(analysis.rr) : null,
    bias: String(analysis.bias ?? "NEUTRAL"),
    summary: direction === "WAIT" ? `WAIT - ${reason}` : reason,
    reasons: [reason, analysis.structure?.lastBOS ? `BOS: ${analysis.structure.lastBOS.direction}` : "No confirmed BOS yet"].filter(Boolean),
    invalidation: "Invalid if price closes beyond the protected order-block/FVG extreme.",
    model: String(gemma.model ?? "gemma-3-27b-it"),
    mode: gemma.fallback ? "local-demo" : "gemma",
  };
}

function decisionFromAnalyzePayload(payload: any): AgentDecision | null {
  const decision = payload?.decision;
  if (!decision) return null;
  return {
    decision: decision.decision === "BUY" || decision.decision === "SELL" ? decision.decision : "WAIT",
    confidence: Number(decision.confidence ?? 0),
    entry: Number.isFinite(Number(decision.entry)) ? Number(decision.entry) : null,
    stopLoss: Number.isFinite(Number(decision.stopLoss)) ? Number(decision.stopLoss) : null,
    takeProfit: Number.isFinite(Number(decision.takeProfit)) ? Number(decision.takeProfit) : null,
    riskReward: Number.isFinite(Number(decision.riskReward)) ? Number(decision.riskReward) : null,
    bias: String(decision.bias ?? "NEUTRAL"),
    summary: String(decision.summary ?? "WAIT - Waiting for clean market snapshot."),
    reasons: Array.isArray(decision.reasons) ? decision.reasons.map(String) : [],
    invalidation: String(decision.invalidation ?? "Invalid if price closes beyond the protected structure."),
    model: String(decision.model ?? "google/gemma-4-31b-it:free"),
    mode: decision.mode === "local-demo" ? "local-demo" : decision.mode === "gemma" ? "gemma" : "openrouter",
  };
}

function warningFromGemma(gemma: any, fallbackWarning?: string) {
  if (fallbackWarning) return fallbackWarning;
  if (!gemma?.fallback) return "";
  const reason = String(gemma.reason || "");
  if (/rate.?limit|429|free-models-per-day|temporarily/i.test(reason)) {
    return "OpenRouter free Gemma quota/rate limit is active; OGFX local SMC fallback is being used until the free provider allows requests again.";
  }
  if (/key is not configured|key missing|required/i.test(reason)) {
    return "AI key missing on backend; OGFX local SMC fallback is active.";
  }
  return "AI provider unavailable; OGFX local SMC fallback is active.";
}

function levelPercent(price: number, min: number, max: number) {
  if (!Number.isFinite(price) || max <= min) return 50;
  return Math.max(8, Math.min(92, 100 - ((price - min) / (max - min)) * 100));
}

export default function DashboardChartsPage() {
  const chartShellRef = useRef<HTMLDivElement | null>(null);
  const [activeAssetId, setActiveAssetId] = useState<string>(TRADING_ASSETS[0].id);
  const [interval, setInterval] = useState<(typeof LIVE_CHART_TIMEFRAMES)[number]>(DEFAULT_INTERVAL);
  const [refreshKey, setRefreshKey] = useState(0);
  const [terminalTab, setTerminalTab] = useState<"OPEN" | "PENDING" | "CLOSED">("OPEN");
  const [snapshots, setSnapshots] = useState<Record<string, MarketSnapshot>>({});
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [account, setAccount] = useState<DemoAccount | null>(null);
  const [settings, setSettings] = useState<DemoSettings | null>(null);
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [userId, setUserId] = useState("");
  const [syncingAccount, setSyncingAccount] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentWarning, setAgentWarning] = useState("");
  const [agentDecision, setAgentDecision] = useState<AgentDecision | null>(null);
  const [agentImage, setAgentImage] = useState<string>("");
  const [notice, setNotice] = useState("");
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [capitalInput, setCapitalInput] = useState("10000");
  const [ticket, setTicket] = useState({
    side: "BUY" as "BUY" | "SELL",
    entry: "",
    stopLoss: "",
    takeProfit: "",
    size: "1",
  });

  const activeAsset = TRADING_ASSETS.find((asset) => asset.id === activeAssetId) ?? TRADING_ASSETS[0];
  const activeSnapshot = snapshots[activeAsset.id];
  const openOrders = orders.filter((order) => order.status === "OPEN");
  const closedOrders = orders.filter((order) => order.status !== "OPEN");
  const displayedRows = terminalTab === "OPEN" ? openOrders : terminalTab === "CLOSED" ? closedOrders : [];
  const activeOpenOrders = openOrders.filter((order) => order.asset_id === activeAsset.id);
  const activeLevelPrices = [
    Number(activeSnapshot?.latest?.close),
    Number(ticket.entry),
    Number(ticket.stopLoss),
    Number(ticket.takeProfit),
    ...activeOpenOrders.flatMap((order) => [Number(order.entry), Number(order.stop_loss), Number(order.take_profit)]),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const levelMin = activeLevelPrices.length ? Math.min(...activeLevelPrices) : 0;
  const levelMax = activeLevelPrices.length ? Math.max(...activeLevelPrices) : 0;
  const levelPad = Math.max((levelMax - levelMin) * 0.3, Number(activeSnapshot?.atr ?? 0) * 1.8, Math.abs(levelMax || 1) * 0.001);
  const chartLevelMin = levelMin - levelPad;
  const chartLevelMax = levelMax + levelPad;

  const bidAsk = useMemo(() => {
    const close = Number(activeSnapshot?.latest?.close ?? 0);
    const spread = close ? Math.max(close * 0.00008, Math.abs(activeSnapshot?.atr ?? 0) * 0.015) : 0;
    return {
      bid: close ? close - spread / 2 : 0,
      ask: close ? close + spread / 2 : 0,
    };
  }, [activeSnapshot?.latest?.close, activeSnapshot?.atr]);
  const statusCards = [
    { label: "Live provider", value: "TradingView", detail: "clean chart default", icon: ShieldCheck },
    {
      label: "Market sync",
      value: snapshotsLoading ? "Refreshing" : "Ready",
      detail: "Yahoo snapshots for TP/SL",
      icon: RefreshCw,
    },
    { label: "Demo storage", value: "Supabase", detail: "capital, orders, history", icon: Wallet },
    {
      label: "Crons",
      value: settings?.auto_trading_enabled ? "Auto enabled" : "Manual only",
      detail: "guarded by CRON_SECRET",
      icon: Bot,
    },
  ];

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? "");
    });
  }, []);

  async function loadSnapshots() {
    setSnapshotsLoading(true);
    try {
      const response = await fetch(`/api/market/snapshot?timeframe=${snapshotTimeframe(interval.value)}`);
      const payload = await response.json();
      const next: Record<string, MarketSnapshot> = {};
      for (const snapshot of payload.snapshots ?? []) next[snapshot.assetId] = snapshot;
      setSnapshots(next);
    } finally {
      setSnapshotsLoading(false);
    }
  }

  async function loadDemoAccount() {
    if (!userId) return;
    setSyncingAccount(true);
    try {
      const [accountPayload, ordersPayload] = await Promise.all([
        backendJson<{ account: DemoAccount }>(`/api/demo/account/${userId}`),
        backendJson<{ orders: BackendOrder[] }>(`/api/demo/orders/${userId}`),
      ]);
      setAccount(accountPayload.account);
      setOrders((ordersPayload.orders ?? []).map(toDemoOrder));
      setCapitalInput(String(Number(accountPayload.account?.initial_balance ?? accountPayload.account?.balance ?? 10000)));
      const settingsResponse = await fetch("/api/demo/settings", { cache: "no-store" });
      const settingsPayload = await settingsResponse.json().catch(() => ({}));
      if (settingsResponse.ok) setSettings(settingsPayload.settings);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to sync demo account");
    } finally {
      setSyncingAccount(false);
    }
  }

  useEffect(() => {
    loadSnapshots();
    const handle = window.setInterval(loadSnapshots, 30000);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval.value, refreshKey]);

  useEffect(() => {
    if (!userId) return;
    loadDemoAccount();
    const handle = window.setInterval(loadDemoAccount, 30000);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const handleFullscreen = () => setIsChartFullscreen(document.fullscreenElement === chartShellRef.current);
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  useEffect(() => {
    setTicket((current) => ({
      ...current,
      size: settings?.default_size ? String(settings.default_size) : current.size,
      ...defaultLevels(current.side, activeSnapshot),
    }));
  }, [activeAsset.id, activeSnapshot?.latest?.time, settings?.default_size]);

  async function runAgent(forceAi = false) {
    if (!userId) {
      setAgentWarning("Authentication required before analysis.");
      return;
    }
    setAgentLoading(true);
    setAgentWarning("");

    try {
      const payload = await backendJson<any>("/api/signal/generate", {
        method: "POST",
        body: JSON.stringify({
          symbol: activeAsset.id,
          timeframe: chartIntervalToApi(interval.value),
          userId,
        }),
      });
      let nextDecision = decisionFromSignalPayload(payload);
      let nextWarning = warningFromGemma(payload.gemma);

      if ((forceAi || agentImage) && activeSnapshot?.latest) {
        const response = await fetch("/api/agent/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetId: activeAsset.id,
            interval: chartIntervalToApi(interval.value),
            snapshot: activeSnapshot,
            imageDataUrl: agentImage || undefined,
            strategyLogic: {
              source: agentImage ? "Live Charts attached screenshot" : "Live Charts manual analysis",
              rule: "Use OGFX SMC confluence: liquidity sweep, BOS/MSS/CHOCH, order block, FVG, HTF bias, and TP/SL risk preservation.",
            },
            requireGemma: true,
          }),
        });
        const raw = await response.text();
        const imagePayload = raw ? JSON.parse(raw) : {};
        if (!response.ok) throw new Error(imagePayload.error || "Chart image analysis failed");
        nextDecision = decisionFromAnalyzePayload(imagePayload) ?? nextDecision;
        nextWarning = imagePayload.warning || "";
      }

      setAgentDecision(nextDecision);
      setAgentWarning(nextWarning);
    } catch (error) {
      setAgentWarning(error instanceof Error ? error.message : "Agent analysis failed");
    } finally {
      setAgentLoading(false);
    }
  }

  useEffect(() => {
    if (!userId) return;
    runAgent(false);
    const handle = window.setInterval(runAgent, 60000);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAsset.id, interval.value, userId]);

  function updateTicketSide(side: "BUY" | "SELL") {
    setTicket((current) => ({
      ...current,
      side,
      ...defaultLevels(side, activeSnapshot),
    }));
  }

  async function openFullscreenChart() {
    const node = chartShellRef.current;
    if (!node) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await node.requestFullscreen();
  }

  function useAgentLevels() {
    if (!agentDecision || agentDecision.decision === "WAIT") return;
    const side = agentDecision.decision === "SELL" ? "SELL" : "BUY";
    setTicket((current) => ({
      ...current,
      side,
      entry: formatPrice(agentDecision.entry ?? activeSnapshot?.latest?.close),
      stopLoss: formatPrice(agentDecision.stopLoss),
      takeProfit: formatPrice(agentDecision.takeProfit),
    }));
  }

  function attachAgentImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Attach a chart image file.");
      return;
    }
    if (file.size > 4_500_000) {
      setNotice("Image is too large. Use a chart screenshot under 4.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAgentImage(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  async function saveSettings(next: Partial<DemoSettings>) {
    if (!settings) return;
    const merged = { ...settings, ...next };
    setSettings(merged);
    const response = await fetch("/api/demo/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        autoTradingEnabled: merged.auto_trading_enabled,
        riskPerTrade: merged.risk_per_trade,
        maxOpenTrades: merged.max_open_trades,
        defaultSize: merged.default_size,
        watchedAssets: merged.watched_assets,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setNotice(payload.error || "Failed to update demo settings");
      return;
    }
    setSettings(payload.settings);
  }

  async function setCapital() {
    const response = await fetch("/api/demo/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initialBalance: Number(capitalInput) }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setNotice(payload.error || "Failed to update capital");
      return;
    }
    setAccount(payload.account);
    await loadDemoAccount();
    setNotice("Demo capital saved in Supabase.");
  }

  async function placeOrder() {
    if (!userId) {
      setNotice("Authentication required before placing demo orders.");
      return;
    }
    try {
      const payload = await backendJson<{ order: BackendOrder; account: DemoAccount }>("/api/demo/place-order", {
        method: "POST",
        body: JSON.stringify({
          userId,
          symbol: activeAsset.id,
          direction: ticket.side,
          lotSize: Number(ticket.size),
          entry: Number(ticket.entry),
          sl: Number(ticket.stopLoss),
          tp: Number(ticket.takeProfit),
          source: agentDecision?.decision === ticket.side ? "agent" : "manual",
          confidence: agentDecision?.decision === ticket.side ? agentDecision.confidence : null,
          reason: agentDecision?.decision === ticket.side ? agentDecision.summary : null,
        }),
      });

      setOrders((current) => [toDemoOrder(payload.order), ...current]);
      setAccount(payload.account);
      setTerminalTab("OPEN");
      setNotice(`Place demo ${ticket.side} succeeded.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to place demo order");
    }
  }

  async function closeOrder(orderId: string) {
    if (!userId) {
      setNotice("Authentication required before closing demo orders.");
      return;
    }
    try {
      await backendJson("/api/demo/close-order", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          userId,
          closePrice: activeSnapshot?.latest?.close ?? bidAsk.bid,
        }),
      });
      await loadDemoAccount();
      setNotice("Order closed and capital synced.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to close order");
    }
  }

  return (
    <div className="-mx-2 -my-2 space-y-3 lg:-mx-4">
      <section className="overflow-hidden rounded-2xl border border-[#22313f] bg-[#071017] shadow-[0_30px_100px_rgba(0,0,0,0.38)]">
        <div className="flex min-h-14 flex-col border-b border-[#243440] bg-[#101b24] lg:flex-row lg:items-center">
          <div className="flex items-center gap-3 border-b border-[#243440] px-3 py-2 lg:w-56 lg:border-b-0 lg:border-r">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-lime-300 text-sm font-black text-slate-950">OG</div>
            <div>
              <div className="text-sm font-black tracking-[0.18em] text-white">OGFX</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Web Terminal</div>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-2 py-2">
            {TRADING_ASSETS.map((asset) => {
              const snapshot = snapshots[asset.id];
              const active = asset.id === activeAsset.id;
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => setActiveAssetId(asset.id)}
                  className={cn(
                    "flex h-10 min-w-[128px] items-center gap-2 border-b-2 px-3 text-left text-sm transition-colors",
                    active
                      ? "border-cyan-300 bg-[#172733] text-white"
                      : "border-transparent text-slate-300 hover:bg-white/[0.04] hover:text-white"
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: asset.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{asset.id}</span>
                    <span className={cn("block text-[10px]", (snapshot?.dayChangePct ?? 0) >= 0 ? "text-emerald-300" : "text-red-300")}>
                      {(snapshot?.dayChangePct ?? 0).toFixed(2)}%
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 border-t border-[#243440] px-3 py-2 lg:border-l lg:border-t-0">
            <div className="text-right">
              <div className="flex items-center justify-end gap-2 text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                <span className="rounded bg-emerald-400/15 px-1.5 py-0.5">Demo</span>
                Standard
              </div>
              <div className="font-mono text-sm font-bold text-white">{formatMoney(account?.equity, account?.currency ?? "USD")}</div>
            </div>
            <Button type="button" onClick={setCapital} className="h-9 rounded-lg bg-cyan-300 px-4 text-slate-950 hover:bg-cyan-200">
              Set capital
            </Button>
          </div>
        </div>

        <div className="flex flex-col border-b border-[#243440] bg-[#0c151c] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-3 py-2">
            {LIVE_CHART_TIMEFRAMES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setInterval(item)}
                className={cn(
                  "h-8 min-w-10 rounded px-2 text-xs font-bold transition-colors",
                  interval.value === item.value
                    ? "bg-cyan-300 text-slate-950"
                    : "text-slate-400 hover:bg-white/[0.06] hover:text-white"
                )}
                title={item.description}
              >
                {item.label}
              </button>
            ))}
            <div className="mx-2 h-5 w-px bg-white/10" />
            {[
              { icon: MousePointer2, label: "Pointer" },
              { icon: Crosshair, label: "Crosshair" },
              { icon: Layers3, label: "Objects" },
              { icon: PanelRight, label: "Panel" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  className="grid h-8 w-8 place-items-center rounded text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
                  title={item.label}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
            <span className="ml-2 whitespace-nowrap text-xs text-slate-500">Plain TradingView chart</span>
          </div>

          <div className="flex items-center gap-3 px-3 py-2 text-xs text-slate-400">
            <span>{activeAsset.id}</span>
            <span className="text-slate-600">/</span>
            <span>Bid {formatPrice(bidAsk.bid)}</span>
            <span>Ask {formatPrice(bidAsk.ask)}</span>
            <button
              type="button"
              onClick={openFullscreenChart}
              className="grid h-8 w-8 place-items-center rounded text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Fullscreen chart"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
              className="grid h-8 w-8 place-items-center rounded text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Refresh market"
            >
              <RefreshCw className={cn("h-4 w-4", snapshotsLoading && "animate-spin")} />
            </button>
          </div>
        </div>

        <div className="grid min-h-[690px] xl:grid-cols-[46px_minmax(0,1fr)_342px]">
          <div className="hidden border-r border-[#243440] bg-[#101b24] py-2 xl:block">
            {[
              Crosshair,
              Minus,
              Target,
              Settings2,
              Lock,
              Clock3,
              Zap,
              History,
              X,
            ].map((Icon, index) => (
              <button
                key={index}
                type="button"
                className="mx-auto mb-1 grid h-10 w-10 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>

          <div ref={chartShellRef} className="relative min-h-[560px] bg-[#05080c] fullscreen:min-h-screen">
            <TradingViewAdvancedChart
              key={`${activeAsset.tradingViewSymbol}-${interval.value}-${refreshKey}`}
              symbol={activeAsset.tradingViewSymbol}
              interval={interval.value}
              height={isChartFullscreen && typeof window !== "undefined" ? window.innerHeight : 690}
              terminal
            />
            <div className="pointer-events-none absolute inset-x-3 top-8 bottom-10">
              {[
                { label: "Entry", value: Number(ticket.entry), tone: "border-cyan-300/70 bg-cyan-300 text-slate-950" },
                { label: "SL", value: Number(ticket.stopLoss), tone: "border-red-300/70 bg-red-300 text-slate-950" },
                { label: "TP", value: Number(ticket.takeProfit), tone: "border-emerald-300/70 bg-emerald-300 text-slate-950" },
              ].filter((level) => Number.isFinite(level.value) && level.value > 0).map((level) => (
                <div
                  key={level.label}
                  className="absolute left-0 right-0"
                  style={{ top: `${levelPercent(level.value, chartLevelMin, chartLevelMax)}%` }}
                >
                  <div className={cn("border-t border-dashed", level.tone.split(" ")[0])} />
                  <div className={cn("absolute right-3 -mt-3 rounded px-2 py-1 text-[10px] font-black shadow-lg", level.tone)}>
                    {level.label} {formatPrice(level.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="border-t border-[#243440] bg-[#0d171f] xl:border-l xl:border-t-0">
            <div className="border-b border-[#243440] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-black text-white">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeAsset.color }} />
                    {activeAsset.id}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{activeAsset.name}</div>
                </div>
                <span
                  className={cn(
                    "rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
                    activeSnapshot?.trend === "BULLISH"
                      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                      : activeSnapshot?.trend === "BEARISH"
                        ? "border-red-300/25 bg-red-300/10 text-red-200"
                        : "border-white/10 text-slate-400"
                  )}
                >
                  {activeSnapshot?.trend ?? "Syncing"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-black/25 p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Bid</div>
                  <div className="mt-1 font-mono text-lg font-black text-white">{formatPrice(bidAsk.bid)}</div>
                </div>
                <div className="rounded-xl bg-black/25 p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Ask</div>
                  <div className="mt-1 font-mono text-lg font-black text-white">{formatPrice(bidAsk.ask)}</div>
                </div>
              </div>
            </div>

            <div className="border-b border-[#243440] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Wallet className="h-4 w-4 text-cyan-200" />
                  Demo account
                </div>
                <button
                  type="button"
                  onClick={loadDemoAccount}
                  className="grid h-8 w-8 place-items-center rounded text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
                  title="Sync account"
                >
                  <RefreshCw className={cn("h-4 w-4", syncingAccount && "animate-spin")} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ["Balance", formatMoney(account?.balance, account?.currency ?? "USD")],
                  ["Equity", formatMoney(account?.equity, account?.currency ?? "USD")],
                  ["Free margin", formatMoney(account?.free_margin, account?.currency ?? "USD")],
                  ["Margin", formatMoney(account?.margin, account?.currency ?? "USD")],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-black/20 p-3">
                    <div className="text-slate-500">{label}</div>
                    <div className="mt-1 truncate font-mono font-bold text-white">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={capitalInput}
                  onChange={(event) => setCapitalInput(event.target.value)}
                  inputMode="decimal"
                  className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 font-mono text-sm text-white outline-none focus:border-cyan-300/40"
                />
                <Button type="button" onClick={setCapital} variant="glass" className="h-10 rounded-lg px-3">
                  Save
                </Button>
              </div>
            </div>

            <div className="border-b border-[#243440] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Bot className="h-4 w-4 text-cyan-200" />
                  Gemma vision analyst
                </div>
                <Button type="button" size="sm" variant="glass" onClick={() => runAgent(true)} disabled={agentLoading} className="h-8 rounded-lg">
                  {agentLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Analyze
                </Button>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-2xl font-black text-white">{agentDecision?.decision ?? "WAIT"}</div>
                  <span className="rounded bg-cyan-300/10 px-2 py-1 text-xs font-bold text-cyan-100">
                    {agentDecision?.confidence ?? 0}%
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  {agentDecision?.summary ?? "Waiting for a clean market snapshot."}
                </p>
                {agentWarning ? <p className="mt-2 text-xs text-amber-200">{agentWarning}</p> : null}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    ["Entry", agentDecision?.entry],
                    ["SL", agentDecision?.stopLoss],
                    ["TP", agentDecision?.takeProfit],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-white/[0.04] p-2">
                      <div className="text-[10px] text-slate-500">{label}</div>
                      <div className="truncate font-mono text-xs text-white">{formatPrice(value as number | null)}</div>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  onClick={useAgentLevels}
                  disabled={!agentDecision || agentDecision.decision === "WAIT"}
                  variant="glass"
                  className="mt-3 h-9 w-full rounded-lg"
                >
                  Use agent TP/SL
                </Button>
                <label className="mt-3 flex h-9 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-xs font-semibold text-slate-300 transition-colors hover:text-white">
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => attachAgentImage(event.target.files?.[0])}
                  />
                  {agentImage ? "Chart image attached" : "Attach chart image"}
                </label>
              </div>
            </div>

            <div className="p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <CircleDollarSign className="h-4 w-4 text-amber-200" />
                New order
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["BUY", "SELL"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => updateTicketSide(side)}
                    className={cn(
                      "flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-black transition-colors",
                      ticket.side === side
                        ? side === "BUY"
                          ? "border-emerald-300/35 bg-emerald-300/15 text-emerald-100"
                          : "border-red-300/35 bg-red-300/15 text-red-100"
                        : "border-white/10 bg-black/20 text-slate-400 hover:text-white"
                    )}
                  >
                    {side === "BUY" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {side}
                  </button>
                ))}
              </div>

              <div className="mt-3 grid gap-2">
                {[
                  ["entry", "Entry"],
                  ["stopLoss", "Stop loss"],
                  ["takeProfit", "Take profit"],
                  ["size", "Lot size"],
                ].map(([key, label]) => (
                  <label key={key} className="block text-xs text-slate-500">
                    {label}
                    <input
                      value={ticket[key as keyof typeof ticket]}
                      onChange={(event) => setTicket((current) => ({ ...current, [key]: event.target.value }))}
                      className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 font-mono text-sm text-white outline-none focus:border-cyan-300/40"
                      inputMode="decimal"
                    />
                  </label>
                ))}
              </div>

              <Button type="button" onClick={placeOrder} className="mt-4 h-12 w-full rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
                <Play className="mr-2 h-4 w-4" />
                Place demo {ticket.side}
              </Button>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <Activity className="h-4 w-4 text-emerald-300" />
                    Auto demo agent
                  </div>
                  <button
                    type="button"
                    onClick={() => saveSettings({ auto_trading_enabled: !settings?.auto_trading_enabled })}
                    className={cn(
                      "relative h-6 w-11 rounded-full transition-colors",
                      settings?.auto_trading_enabled ? "bg-emerald-400" : "bg-slate-700"
                    )}
                    aria-label="Toggle auto demo agent"
                  >
                    <span
                      className={cn(
                        "absolute top-1 h-4 w-4 rounded-full bg-white transition-transform",
                        settings?.auto_trading_enabled ? "translate-x-6" : "translate-x-1"
                      )}
                    />
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Cron endpoint can open demo trades only when this is enabled.
                </p>
              </div>
            </div>
          </aside>
        </div>

        <div className="border-t border-[#243440] bg-[#0c151c]">
          <div className="flex items-center justify-between border-b border-[#243440] px-3">
            <div className="flex">
              {[
                ["OPEN", `Open ${openOrders.length}`],
                ["PENDING", "Pending 0"],
                ["CLOSED", `Closed ${closedOrders.length}`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTerminalTab(key as "OPEN" | "PENDING" | "CLOSED")}
                  className={cn(
                    "h-10 border-b-2 px-4 text-xs font-bold transition-colors",
                    terminalTab === key
                      ? "border-cyan-300 text-white"
                      : "border-transparent text-slate-500 hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              Supabase synced
            </div>
          </div>

          <div className="max-h-64 overflow-auto">
            {displayedRows.length ? (
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="sticky top-0 bg-[#101b24] text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Asset</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Size</th>
                    <th className="px-4 py-3 font-semibold">Entry</th>
                    <th className="px-4 py-3 font-semibold">SL</th>
                    <th className="px-4 py-3 font-semibold">TP</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">PnL</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRows.map((order) => (
                    <tr key={order.id} className="border-t border-white/5 text-slate-300">
                      <td className="px-4 py-3">{new Date(order.opened_at).toLocaleString()}</td>
                      <td className="px-4 py-3 font-bold text-white">{order.asset_id}</td>
                      <td className={cn("px-4 py-3 font-bold", order.side === "BUY" ? "text-emerald-300" : "text-red-300")}>
                        {order.side}
                      </td>
                      <td className="px-4 py-3 font-mono">{formatPrice(order.size)}</td>
                      <td className="px-4 py-3 font-mono">{formatPrice(order.entry)}</td>
                      <td className="px-4 py-3 font-mono text-red-300">{formatPrice(order.stop_loss)}</td>
                      <td className="px-4 py-3 font-mono text-emerald-300">{formatPrice(order.take_profit)}</td>
                      <td className="px-4 py-3">{order.status}</td>
                      <td className={cn("px-4 py-3 font-mono", (order.pnl ?? 0) >= 0 ? "text-emerald-300" : "text-red-300")}>
                        {order.pnl == null ? "-" : formatMoney(order.pnl, account?.currency ?? "USD")}
                      </td>
                      <td className="px-4 py-3">
                        {order.status === "OPEN" ? (
                          <button
                            type="button"
                            onClick={() => closeOrder(order.id)}
                            className="rounded border border-white/10 px-2 py-1 text-slate-400 transition-colors hover:border-white/20 hover:text-white"
                          >
                            Close
                          </button>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex min-h-28 items-center justify-center text-sm text-slate-500">
                {terminalTab === "PENDING" ? "Pending orders are not enabled yet." : "No orders in this tab."}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-[#243440] px-3 py-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-4">
              <span>Equity: <strong className="font-mono text-white">{formatMoney(account?.equity, account?.currency ?? "USD")}</strong></span>
              <span>Free Margin: <strong className="font-mono text-white">{formatMoney(account?.free_margin, account?.currency ?? "USD")}</strong></span>
              <span>Margin Level: <strong className="font-mono text-white">{account?.margin_level ? `${account.margin_level.toFixed(2)}%` : "-"}</strong></span>
            </div>
            <div className="truncate text-amber-200">{notice}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        {statusCards.map(({ label, value, detail, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
              <Icon className="h-4 w-4 text-cyan-200" />
              {label}
            </div>
            <div className="mt-2 text-lg font-black text-white">{value}</div>
            <div className="mt-1 text-xs text-slate-500">{detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
