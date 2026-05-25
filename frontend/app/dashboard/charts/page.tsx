"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Target,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { LIVE_CHART_TIMEFRAMES, TRADING_ASSETS } from "@/lib/assets";
import { Button } from "@/components/ui/button";
import { LiveSmcChart } from "@/components/charts/LiveSmcChart";
import { chartIntervalToApi } from "@/lib/backend-api";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  formatAssetPrice,
  normalizeLeverage,
  normalizeLotSize,
  orderMargin,
  orderPnl,
  orderRiskReward,
  roundPriceForAsset,
} from "@/lib/trade-math";
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
  candles?: any[];
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
  mode: "gemma" | "local-demo";
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
  leverage: number;
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
  status: "OPEN" | "PENDING" | "TP" | "SL" | "CLOSED";
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

function formatPrice(value: number | null | undefined, assetId?: string | null) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  if (assetId) return formatAssetPrice(assetId, Number(value));
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

function formatLots(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const amount = Number(value);
  return amount < 1 ? amount.toFixed(2) : amount.toFixed(2).replace(/\.00$/, "");
}

function defaultPartialSize(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  if (amount <= 0.01) return formatLots(amount);
  return formatLots(Math.max(0.01, Number((amount / 2).toFixed(2))));
}

function floatingOrderPnl(order: Pick<DemoOrder, "asset_id" | "entry" | "side" | "size">, exitPrice: number) {
  if (!Number.isFinite(exitPrice)) return null;
  return orderPnl({
    assetId: order.asset_id,
    entry: Number(order.entry),
    side: order.side,
    size: Number(order.size),
    exitPrice,
  });
}

function quoteFromSnapshot(snapshot?: MarketSnapshot) {
  const close = Number(snapshot?.latest?.close ?? 0);
  const spread = close ? Math.max(close * 0.00008, Math.abs(snapshot?.atr ?? 0) * 0.015) : 0;
  return {
    bid: close ? close - spread / 2 : 0,
    ask: close ? close + spread / 2 : 0,
    mid: close,
  };
}

function exitPriceForOrder(order: DemoOrder, snapshots: Record<string, MarketSnapshot>) {
  const quote = quoteFromSnapshot(snapshots[order.asset_id]);
  const exitPrice = order.side === "SELL" ? quote.ask : quote.bid;
  return exitPrice || Number(order.entry);
}

function defaultLevels(side: "BUY" | "SELL", snapshot?: MarketSnapshot) {
  const close = Number(snapshot?.latest?.close ?? 0);
  const atr = Number(snapshot?.atr ?? 0);
  const distance = close ? (atr > 0 ? atr * 1.4 : close * 0.004) : 0;
  const target = distance * 2;

  return {
    entry: close ? formatPrice(close, snapshot?.assetId) : "",
    stopLoss: close ? formatPrice(side === "BUY" ? close - distance : close + distance, snapshot?.assetId) : "",
    takeProfit: close ? formatPrice(side === "BUY" ? close + target : close - target, snapshot?.assetId) : "",
  };
}

function toDemoOrder(order: BackendOrder | DemoOrder): DemoOrder {
  const raw = ("raw" in order ? order.raw ?? {} : order) as Partial<DemoOrder>;
  const status = "status" in order ? String(order.status).toLowerCase() : "open";
  const mappedStatus =
    status === "pending" ? "PENDING" :
    status === "closed" ? "CLOSED" :
    status === "tp" ? "TP" :
    status === "sl" ? "SL" :
    "OPEN";
  return {
    id: order.id,
    asset_id: "asset_id" in order ? order.asset_id : order.symbol,
    trading_view_symbol: raw.trading_view_symbol ?? null,
    side: "side" in order ? order.side : order.direction,
    entry: "entry" in order ? Number(order.entry) : 0,
    stop_loss: "stop_loss" in order ? Number(order.stop_loss) : Number(order.sl),
    take_profit: "take_profit" in order ? Number(order.take_profit) : Number(order.tp),
    size: "size" in order ? Number(order.size) : Number(order.lotSize),
    status: mappedStatus,
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

function decisionFromAnalyzePayload(payload: any): AgentDecision | null {
  const decision = payload?.decision ?? payload?.analysis;
  if (!decision) return null;
  const action = decision.decision ?? decision.bias;
  const mode = decision.mode === "local-demo" || decision.provider === "local" ? "local-demo" : "gemma";
  return {
    decision: action === "BUY" || action === "SELL" ? action : "WAIT",
    confidence: Number(decision.confidence ?? 0),
    entry: Number.isFinite(Number(decision.entry)) ? Number(decision.entry) : null,
    stopLoss: Number.isFinite(Number(decision.stopLoss ?? decision.stop_loss)) ? Number(decision.stopLoss ?? decision.stop_loss) : null,
    takeProfit: Number.isFinite(Number(decision.takeProfit ?? decision.take_profit)) ? Number(decision.takeProfit ?? decision.take_profit) : null,
    riskReward: Number.isFinite(Number(decision.riskReward ?? decision.rr_ratio)) ? Number(decision.riskReward ?? decision.rr_ratio) : null,
    bias: String(decision.bias ?? "NEUTRAL"),
    summary: String(decision.summary ?? decision.reasoning ?? decision.gemma_analysis ?? "WAIT - Waiting for clean market snapshot."),
    reasons: Array.isArray(decision.reasons) ? decision.reasons.map(String) : Array.isArray(decision.checklist) ? decision.checklist.map((item: any) => `${item.label}: ${item.status}`) : [],
    invalidation: String(decision.invalidation ?? "Invalid if price closes beyond the protected structure."),
    model: String(decision.model ?? (mode === "local-demo" ? "ogfx-smc-fallback" : "gemma-4-26b-a4b-it")),
    mode,
  };
}

function levelPercent(price: number, min: number, max: number) {
  if (!Number.isFinite(price) || max <= min) return 50;
  return Math.max(8, Math.min(92, 100 - ((price - min) / (max - min)) * 100));
}

export default function DashboardChartsPage() {
  const chartShellRef = useRef<HTMLDivElement | null>(null);
  const levelOverlayRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef({ min: 0, max: 1 });
  const ticketRef = useRef({ side: "BUY" as "BUY" | "SELL", entry: "", stopLoss: "", takeProfit: "", size: "1" });
  const ordersRef = useRef<DemoOrder[]>([]);
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
  const [nativeChartImage, setNativeChartImage] = useState<string>("");
  const [notice, setNotice] = useState("");
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [capitalInput, setCapitalInput] = useState("10000");
  const [orderMode, setOrderMode] = useState<"market" | "pending">("market");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [orderEdit, setOrderEdit] = useState({
    entry: "",
    stopLoss: "",
    takeProfit: "",
    size: "",
    closeSize: "",
  });
  const [ticket, setTicket] = useState({
    side: "BUY" as "BUY" | "SELL",
    entry: "",
    stopLoss: "",
    takeProfit: "",
    size: "1",
  });
  const [dragTarget, setDragTarget] = useState<null | {
    kind: "ticket" | "order";
    field: "entry" | "stopLoss" | "takeProfit";
    orderId?: string;
  }>(null);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [modifyingOrder, setModifyingOrder] = useState(false);
  const [closingOrderId, setClosingOrderId] = useState("");

  const activeAsset = TRADING_ASSETS.find((asset) => asset.id === activeAssetId) ?? TRADING_ASSETS[0];
  const activeSnapshot = snapshots[activeAsset.id];
  const appliedLeverage = normalizeLeverage(settings?.leverage, activeAsset.id);
  const liveOrders = useMemo(() => (
    orders.map((order) => {
      if (order.status !== "OPEN") return order;
      const exitPrice = exitPriceForOrder(order, snapshots);
      return { ...order, pnl: floatingOrderPnl(order, exitPrice) ?? order.pnl };
    })
  ), [orders, snapshots]);
  const openOrders = liveOrders.filter((order) => order.status === "OPEN");
  const pendingOrders = liveOrders.filter((order) => order.status === "PENDING");
  const closedOrders = liveOrders.filter((order) => order.status !== "OPEN" && order.status !== "PENDING");
  const displayedRows = terminalTab === "OPEN" ? openOrders : terminalTab === "PENDING" ? pendingOrders : closedOrders;
  const workingOrders = [...openOrders, ...pendingOrders];
  const activeWorkingOrders = [...openOrders, ...pendingOrders].filter((order) => order.asset_id === activeAsset.id);
  const selectedOrder = selectedOrderId ? workingOrders.find((order) => order.id === selectedOrderId) ?? null : null;
  const selectedOrderIsPending = selectedOrder?.status === "PENDING";
  const activeLevelPrices = [
    Number(activeSnapshot?.latest?.close),
    Number(ticket.entry),
    Number(ticket.stopLoss),
    Number(ticket.takeProfit),
    ...activeWorkingOrders.flatMap((order) => [Number(order.entry), Number(order.stop_loss), Number(order.take_profit)]),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const levelMin = activeLevelPrices.length ? Math.min(...activeLevelPrices) : 0;
  const levelMax = activeLevelPrices.length ? Math.max(...activeLevelPrices) : 0;
  const levelPad = Math.max((levelMax - levelMin) * 0.3, Number(activeSnapshot?.atr ?? 0) * 1.8, Math.abs(levelMax || 1) * 0.001);
  const chartLevelMin = levelMin - levelPad;
  const chartLevelMax = levelMax + levelPad;

  const bidAsk = useMemo(() => quoteFromSnapshot(activeSnapshot), [activeSnapshot]);
  const ticketEntry = Number(ticket.entry);
  const ticketStop = Number(ticket.stopLoss);
  const ticketTarget = Number(ticket.takeProfit);
  const ticketSize = Number(ticket.size);
  const ticketStats = orderRiskReward({
    assetId: activeAsset.id,
    entry: ticketEntry,
    stopLoss: ticketStop,
    takeProfit: ticketTarget,
    side: ticket.side,
    size: Number.isFinite(ticketSize) ? ticketSize : 0,
  });
  const ticketRisk = ticketStats.risk;
  const ticketReward = ticketStats.reward;
  const ticketMargin = orderMargin({
    assetId: activeAsset.id,
    entry: ticketEntry,
    size: Number.isFinite(ticketSize) ? ticketSize : 0,
    leverage: appliedLeverage,
  });
  const ticketRr = ticketStats.rr;
  const ticketValid =
    Number.isFinite(ticketEntry) &&
    Number.isFinite(ticketStop) &&
    Number.isFinite(ticketTarget) &&
    Number.isFinite(ticketSize) &&
    ticketSize > 0 &&
    (ticket.side === "BUY" ? ticketStop < ticketEntry && ticketTarget > ticketEntry : ticketStop > ticketEntry && ticketTarget < ticketEntry);
  const editEntry = Number(selectedOrderIsPending ? orderEdit.entry : selectedOrder?.entry);
  const editStop = Number(orderEdit.stopLoss);
  const editTarget = Number(orderEdit.takeProfit);
  const editSize = Number(orderEdit.size);
  const editCloseSize = Number(orderEdit.closeSize);
  const editValid = Boolean(
    selectedOrder &&
      Number.isFinite(editEntry) &&
      Number.isFinite(editStop) &&
      Number.isFinite(editTarget) &&
      Number.isFinite(editSize) &&
      editSize > 0 &&
      (selectedOrder.side === "BUY" ? editStop < editEntry && editTarget > editEntry : editStop > editEntry && editTarget < editEntry)
  );
  const closeSizeValid = Boolean(
    selectedOrder &&
      selectedOrder.status === "OPEN" &&
      Number.isFinite(editCloseSize) &&
      editCloseSize > 0 &&
      editCloseSize < Number(selectedOrder.size)
  );
  const selectedExitPrice = selectedOrder ? exitPriceForOrder(selectedOrder, snapshots) : 0;
  const selectedFloatingPnl =
    selectedOrder && selectedOrder.status === "OPEN" ? floatingOrderPnl(selectedOrder, selectedExitPrice) : null;
  const liveAccount = useMemo(() => {
    if (!account) return null;
    const floatingPnl = openOrders.reduce((sum, order) => sum + Number(order.pnl ?? 0), 0);
    const margin = openOrders.reduce((sum, order) => sum + orderMargin({
      assetId: order.asset_id,
      entry: Number(order.entry),
      size: Number(order.size),
      leverage: normalizeLeverage(settings?.leverage, order.asset_id),
    }), 0);
    const balance = Number(account.balance ?? account.initial_balance ?? 10000);
    const equity = Number((balance + floatingPnl).toFixed(2));
    const roundedMargin = Number(margin.toFixed(2));
    const freeMargin = Number((equity - roundedMargin).toFixed(2));
    return {
      ...account,
      equity,
      margin: roundedMargin,
      free_margin: freeMargin,
      margin_level: roundedMargin > 0 ? Number(((equity / roundedMargin) * 100).toFixed(2)) : null,
    };
  }, [account, openOrders, settings?.leverage]);
  const displayAccount = liveAccount ?? account;
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

  useEffect(() => {
    ticketRef.current = ticket;
  }, [ticket]);

  useEffect(() => {
    ordersRef.current = liveOrders;
  }, [liveOrders]);

  useEffect(() => {
    scaleRef.current = { min: chartLevelMin, max: chartLevelMax };
  }, [chartLevelMin, chartLevelMax]);

  const priceFromPointer = useCallback((clientY: number) => {
    const node = levelOverlayRef.current;
    const { min, max } = scaleRef.current;
    if (!node || max <= min) return null;
    const rect = node.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return max - (y / rect.height) * (max - min);
  }, []);

  const constrainLevelPrice = useCallback((target: NonNullable<typeof dragTarget>, rawPrice: number) => {
    const order = target.kind === "order" ? ordersRef.current.find((item) => item.id === target.orderId) : null;
    const assetId = order?.asset_id ?? activeAsset.id;
    const current = target.kind === "ticket"
      ? ticketRef.current
      : {
          side: order?.side ?? "BUY",
          entry: String(order?.entry ?? ""),
          stopLoss: String(order?.stop_loss ?? ""),
          takeProfit: String(order?.take_profit ?? ""),
        };
    const side = current.side === "SELL" ? "SELL" : "BUY";
    const entry = Number(current.entry);
    const stop = Number(current.stopLoss);
    const targetPrice = Number(current.takeProfit);
    const minDistance = Math.max(Math.abs(entry || rawPrice) * 0.00002, Math.abs(activeSnapshot?.atr ?? 0) * 0.02, 0.00001);
    let price = rawPrice;

    if (target.field === "stopLoss" && Number.isFinite(entry)) {
      price = side === "BUY" ? Math.min(price, entry - minDistance) : Math.max(price, entry + minDistance);
    }
    if (target.field === "takeProfit" && Number.isFinite(entry)) {
      price = side === "BUY" ? Math.max(price, entry + minDistance) : Math.min(price, entry - minDistance);
    }
    if (target.field === "entry" && Number.isFinite(stop) && Number.isFinite(targetPrice)) {
      price = side === "BUY"
        ? Math.max(stop + minDistance, Math.min(targetPrice - minDistance, price))
        : Math.min(stop - minDistance, Math.max(targetPrice + minDistance, price));
    }

    return roundPriceForAsset(assetId, price);
  }, [activeAsset.id, activeSnapshot?.atr]);

  const applyDraggedLevel = useCallback((target: NonNullable<typeof dragTarget>, rawPrice: number) => {
    const order = target.kind === "order" ? ordersRef.current.find((item) => item.id === target.orderId) : null;
    const assetId = order?.asset_id ?? activeAsset.id;
    const price = constrainLevelPrice(target, rawPrice);
    const formatted = formatPrice(price, assetId);

    if (target.kind === "ticket") {
      setTicket((current) => ({ ...current, [target.field]: formatted }));
      return;
    }

    if (!target.orderId) return;
    setOrders((current) => current.map((item) => {
      if (item.id !== target.orderId) return item;
      if (target.field === "entry") return { ...item, entry: price };
      if (target.field === "stopLoss") return { ...item, stop_loss: price };
      return { ...item, take_profit: price };
    }));
    if (selectedOrderId === target.orderId) {
      setOrderEdit((current) => ({ ...current, [target.field]: formatted }));
    }
  }, [activeAsset.id, constrainLevelPrice, selectedOrderId]);

  async function commitDraggedOrder(orderId: string) {
    const order = ordersRef.current.find((item) => item.id === orderId);
    if (!order || order.id.startsWith("temp-")) return;
    setModifyingOrder(true);
    try {
      const response = await fetch(`/api/demo/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry: order.entry,
          stopLoss: order.stop_loss,
          takeProfit: order.take_profit,
          size: order.size,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Failed to update order levels");
      const updated = toDemoOrder(payload.order);
      setOrders((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setAccount(payload.account);
      setNotice("Order levels updated from chart.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to update order levels");
      loadDemoAccount();
    } finally {
      setModifyingOrder(false);
    }
  }

  function beginLevelDrag(event: any, target: NonNullable<typeof dragTarget>) {
    event.preventDefault();
    event.stopPropagation();
    setDragTarget(target);
    const price = priceFromPointer(event.clientY);
    if (price != null) applyDraggedLevel(target, price);
  }

  useEffect(() => {
    if (!dragTarget) return;

    const handleMove = (event: PointerEvent) => {
      event.preventDefault();
      const price = priceFromPointer(event.clientY);
      if (price != null) applyDraggedLevel(dragTarget, price);
    };
    const handleUp = () => {
      const target = dragTarget;
      setDragTarget(null);
      if (target.kind === "order" && target.orderId) {
        commitDraggedOrder(target.orderId);
      }
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragTarget, priceFromPointer, applyDraggedLevel]);

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
      const accountResponse = await fetch("/api/demo/account", { cache: "no-store" });
      const accountPayload = await accountResponse.json().catch(() => ({}));
      if (!accountResponse.ok) throw new Error(accountPayload.error || "Failed to load demo account");

      setAccount(accountPayload.account);
      setOrders((accountPayload.orders ?? []).map(toDemoOrder));
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
    const handle = window.setInterval(loadSnapshots, 10000);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval.value, refreshKey]);

  useEffect(() => {
    if (!userId) return;
    loadDemoAccount();
    const handle = window.setInterval(loadDemoAccount, 15000);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`demo-terminal-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "demo_orders", filter: `user_id=eq.${userId}` }, () => {
        loadDemoAccount();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "demo_accounts", filter: `user_id=eq.${userId}` }, () => {
        loadDemoAccount();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
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
      entry: orderMode === "market"
        ? formatPrice(current.side === "BUY" ? bidAsk.ask : bidAsk.bid, activeAsset.id)
        : current.entry || defaultLevels(current.side, activeSnapshot).entry,
    }));
  }, [activeAsset.id, activeSnapshot?.latest?.time, settings?.default_size, orderMode, bidAsk.ask, bidAsk.bid]);

  useEffect(() => {
    if (!selectedOrder) {
      setOrderEdit({ entry: "", stopLoss: "", takeProfit: "", size: "", closeSize: "" });
      return;
    }

    setOrderEdit({
      entry: formatPrice(selectedOrder.entry, selectedOrder.asset_id),
      stopLoss: formatPrice(selectedOrder.stop_loss, selectedOrder.asset_id),
      takeProfit: formatPrice(selectedOrder.take_profit, selectedOrder.asset_id),
      size: formatLots(selectedOrder.size),
      closeSize: defaultPartialSize(selectedOrder.size),
    });
  }, [selectedOrder?.id, selectedOrder?.size, selectedOrder?.status]);

  async function runAgent(forceAi = false) {
    if (!userId) {
      setAgentWarning("Authentication required before analysis.");
      return;
    }
    if (!activeSnapshot?.latest) {
      setAgentWarning("Waiting for a live market snapshot before analysis.");
      return;
    }
    setAgentLoading(true);
    setAgentWarning("");

    try {
      const chartImage = agentImage || nativeChartImage;
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pair: activeAsset.id,
          timeframe: chartIntervalToApi(interval.value),
          snapshot: activeSnapshot,
          imageDataUrl: chartImage || undefined,
          account,
          settings,
          openOrders: openOrders.slice(0, 20),
          pendingOrders: pendingOrders.slice(0, 20),
          activeOrder: selectedOrder,
          history: closedOrders.slice(0, 20),
          saveSignal: forceAi,
          strategyLogic: {
            source: chartImage ? (agentImage ? "Attached chart image" : "Live chart capture") : "Structured live snapshot",
            rule: "Use ANFX LSBR plus Shakuni trap logic: liquidity sweep, BOS/MSS/CHOCH, displacement, retest into OB/FVG/supply/demand, HTF bias, no entry without numeric TP/SL, and respect account capital/open exposure.",
          },
        }),
      });
      const raw = await response.text();
      const payload = raw ? JSON.parse(raw) : {};
      if (!response.ok) throw new Error(payload.error || "Chart analysis failed");

      const nextDecision = decisionFromAnalyzePayload(payload);
      if (!nextDecision) throw new Error("Chart analysis returned no decision");
      setAgentDecision(nextDecision);
      setAgentWarning(payload.analysis?.warning || payload.warning || "");
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
    const next = defaultLevels(side, activeSnapshot);
    setTicket((current) => ({
      ...current,
      side,
      ...next,
      entry: orderMode === "market" ? formatPrice(side === "BUY" ? bidAsk.ask : bidAsk.bid, activeAsset.id) : next.entry,
    }));
  }

  function stepSize(delta: number) {
    setTicket((current) => {
      const next = normalizeLotSize(activeAsset.id, Number(current.size || 0) + delta);
      return { ...current, size: formatLots(next) };
    });
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
      entry: formatPrice(agentDecision.entry ?? activeSnapshot?.latest?.close, activeAsset.id),
      stopLoss: formatPrice(agentDecision.stopLoss, activeAsset.id),
      takeProfit: formatPrice(agentDecision.takeProfit, activeAsset.id),
    }));
  }

  function selectOrder(order: DemoOrder) {
    setSelectedOrderId(order.id);
    if (TRADING_ASSETS.some((asset) => asset.id === order.asset_id)) {
      setActiveAssetId(order.asset_id);
    }
    setOrderEdit({
      entry: formatPrice(order.entry, order.asset_id),
      stopLoss: formatPrice(order.stop_loss, order.asset_id),
      takeProfit: formatPrice(order.take_profit, order.asset_id),
      size: formatLots(order.size),
      closeSize: defaultPartialSize(order.size),
    });
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
        leverage: merged.leverage,
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
    if (!ticketValid) {
      setNotice("Fix volume, entry, stop loss, and take profit before placing this demo order.");
      return;
    }

    const executionEntry = orderMode === "market"
      ? Number(ticket.side === "BUY" ? bidAsk.ask : bidAsk.bid)
      : Number(ticket.entry);
    const now = new Date().toISOString();
    const optimisticId = `temp-${Date.now()}`;
    const optimisticOrder: DemoOrder = {
      id: optimisticId,
      asset_id: activeAsset.id,
      trading_view_symbol: activeAsset.tradingViewSymbol,
      side: ticket.side,
      entry: executionEntry,
      stop_loss: Number(ticket.stopLoss),
      take_profit: Number(ticket.takeProfit),
      size: Number(ticket.size),
      status: orderMode === "pending" ? "PENDING" : "OPEN",
      source: agentDecision?.decision === ticket.side ? "agent" : "manual",
      strategy_name: null,
      confidence: agentDecision?.decision === ticket.side ? agentDecision.confidence : null,
      reason: agentDecision?.decision === ticket.side ? agentDecision.summary : null,
      opened_at: now,
      closed_at: null,
      exit_price: null,
      pnl: orderMode === "pending" ? null : 0,
    };

    setPlacingOrder(true);
    setOrders((current) => [optimisticOrder, ...current]);
    setSelectedOrderId(optimisticId);
    setTerminalTab(orderMode === "pending" ? "PENDING" : "OPEN");
    setNotice(`${orderMode === "pending" ? "Pending" : "Market"} ${ticket.side} sent...`);
    try {
      const response = await fetch("/api/demo/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: activeAsset.id,
          side: ticket.side,
          size: Number(ticket.size),
          entry: executionEntry,
          stopLoss: Number(ticket.stopLoss),
          takeProfit: Number(ticket.takeProfit),
          orderType: orderMode,
          currentPrice: Number(activeSnapshot?.latest?.close ?? executionEntry),
          source: agentDecision?.decision === ticket.side ? "agent" : "manual",
          confidence: agentDecision?.decision === ticket.side ? agentDecision.confidence : null,
          reason: agentDecision?.decision === ticket.side ? agentDecision.summary : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Failed to place demo order");

      const savedOrder = toDemoOrder(payload.order);
      setOrders((current) => current.map((order) => (order.id === optimisticId ? savedOrder : order)));
      setAccount(payload.account);
      setSelectedOrderId(savedOrder.id);
      setTerminalTab(orderMode === "pending" ? "PENDING" : "OPEN");
      setNotice(`${orderMode === "pending" ? "Pending" : "Market"} demo ${ticket.side} order placed.`);
    } catch (error) {
      setOrders((current) => current.filter((order) => order.id !== optimisticId));
      setSelectedOrderId("");
      setNotice(error instanceof Error ? error.message : "Failed to place demo order");
    } finally {
      setPlacingOrder(false);
    }
  }

  async function modifySelectedOrder() {
    if (!selectedOrder) return;
    if (!userId) {
      setNotice("Authentication required before modifying demo orders.");
      return;
    }
    if (!editValid) {
      setNotice("Fix entry, stop loss, take profit, and size before modifying this order.");
      return;
    }

    const previousOrders = ordersRef.current;
    const optimisticOrder: DemoOrder = {
      ...selectedOrder,
      entry: selectedOrderIsPending ? Number(orderEdit.entry) : selectedOrder.entry,
      stop_loss: Number(orderEdit.stopLoss),
      take_profit: Number(orderEdit.takeProfit),
      size: selectedOrderIsPending ? Number(orderEdit.size) : selectedOrder.size,
    };
    setModifyingOrder(true);
    setOrders((current) => current.map((order) => (order.id === selectedOrder.id ? optimisticOrder : order)));
    try {
      const response = await fetch(`/api/demo/orders/${selectedOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry: Number(orderEdit.entry),
          stopLoss: Number(orderEdit.stopLoss),
          takeProfit: Number(orderEdit.takeProfit),
          size: Number(orderEdit.size),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Failed to modify order");

      const updated = toDemoOrder(payload.order);
      setOrders((current) => current.map((order) => (order.id === updated.id ? updated : order)));
      setAccount(payload.account);
      setSelectedOrderId(updated.id);
      setNotice("Order levels updated.");
    } catch (error) {
      setOrders(previousOrders);
      setNotice(error instanceof Error ? error.message : "Failed to modify order");
    } finally {
      setModifyingOrder(false);
    }
  }

  async function closeOrder(orderId: string, closeSize?: number) {
    if (!userId) {
      setNotice("Authentication required before closing demo orders.");
      return;
    }
    const orderToClose = ordersRef.current.find((order) => order.id === orderId);
    if (!orderToClose) return;
    const previousOrders = ordersRef.current;
    const exitPrice = orderToClose.status === "OPEN" ? exitPriceForOrder(orderToClose, snapshots) : null;
    const requestedSize = Number(closeSize ?? orderToClose.size);
    const isPartial = orderToClose.status === "OPEN" && Number.isFinite(requestedSize) && requestedSize > 0 && requestedSize < orderToClose.size;
    const closedAt = new Date().toISOString();
    const optimisticPnl = exitPrice ? orderPnl({
      assetId: orderToClose.asset_id,
      entry: orderToClose.entry,
      side: orderToClose.side,
      size: isPartial ? requestedSize : orderToClose.size,
      exitPrice,
    }) : 0;

    setClosingOrderId(orderId);
    setOrders((current) => current.map((order) => {
      if (order.id !== orderId) return order;
      if (isPartial) {
        return { ...order, size: Number((order.size - requestedSize).toFixed(4)), pnl: order.pnl };
      }
      return {
        ...order,
        status: "CLOSED",
        closed_at: closedAt,
        exit_price: exitPrice,
        pnl: optimisticPnl,
      };
    }));
    try {
      const response = await fetch(`/api/demo/orders/${orderId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closeSize, exitPrice }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Failed to close order");
      if (payload.account) setAccount(payload.account);
      if (payload.closed?.partial) {
        setSelectedOrderId(orderId);
        setOrders((current) => current.map((order) => (
          order.id === orderId ? { ...order, size: Number(payload.closed.remainingSize ?? order.size) } : order
        )));
        setNotice(`Partially closed ${formatLots(payload.closed.closedSize)} lots and synced capital.`);
      } else {
        setSelectedOrderId("");
        setNotice("Order closed or cancelled and capital synced.");
      }
      loadDemoAccount();
    } catch (error) {
      setOrders(previousOrders);
      setNotice(error instanceof Error ? error.message : "Failed to close order");
    } finally {
      setClosingOrderId("");
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
              <div className="font-mono text-sm font-bold text-white">{formatMoney(displayAccount?.equity, displayAccount?.currency ?? "USD")}</div>
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
            <span>Bid {formatPrice(bidAsk.bid, activeAsset.id)}</span>
            <span>Ask {formatPrice(bidAsk.ask, activeAsset.id)}</span>
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
            <div ref={levelOverlayRef} className={cn("pointer-events-none absolute inset-x-3 top-8 bottom-10", dragTarget && "cursor-ns-resize")}>
              {[
                { label: "Entry", field: "entry" as const, value: Number(ticket.entry), tone: "border-cyan-300/70 bg-cyan-300 text-slate-950" },
                { label: "SL", field: "stopLoss" as const, value: Number(ticket.stopLoss), tone: "border-red-300/70 bg-red-300 text-slate-950" },
                { label: "TP", field: "takeProfit" as const, value: Number(ticket.takeProfit), tone: "border-emerald-300/70 bg-emerald-300 text-slate-950" },
              ].filter((level) => Number.isFinite(level.value) && level.value > 0).map((level) => (
                <div
                  key={level.label}
                  className="absolute left-0 right-0"
                  style={{ top: `${levelPercent(level.value, chartLevelMin, chartLevelMax)}%` }}
                >
                  <div className={cn("border-t border-dashed", level.tone.split(" ")[0])} />
                  <button
                    type="button"
                    onPointerDown={(event) => beginLevelDrag(event, { kind: "ticket", field: level.field })}
                    className={cn("pointer-events-auto absolute right-3 -mt-3 cursor-ns-resize rounded px-2 py-1 text-[10px] font-black shadow-lg ring-offset-0 transition-transform hover:scale-[1.03]", level.tone)}
                    title={`Drag ${level.label}`}
                  >
                    {level.label} {formatPrice(level.value, activeAsset.id)}
                  </button>
                </div>
              ))}
              {activeWorkingOrders.flatMap((order) => ([
                {
                  key: `${order.id}-entry`,
                  label: order.status === "PENDING" ? "Pending" : "Open",
                  field: "entry" as const,
                  value: order.entry,
                  line: order.status === "PENDING" ? "border-dashed border-amber-200/70" : "border-cyan-200/70",
                  badge: order.status === "PENDING" ? "bg-amber-200 text-slate-950" : "bg-cyan-200 text-slate-950",
                  draggable: order.status === "PENDING",
                },
                {
                  key: `${order.id}-sl`,
                  label: "SL",
                  field: "stopLoss" as const,
                  value: order.stop_loss,
                  line: "border-dashed border-red-300/70",
                  badge: "bg-red-300 text-slate-950",
                  draggable: true,
                },
                {
                  key: `${order.id}-tp`,
                  label: "TP",
                  field: "takeProfit" as const,
                  value: order.take_profit,
                  line: "border-dashed border-emerald-300/70",
                  badge: "bg-emerald-300 text-slate-950",
                  draggable: true,
                },
              ].filter((level) => Number.isFinite(level.value) && level.value > 0).map((level) => (
                <div
                  key={level.key}
                  className="absolute left-0 right-0"
                  style={{ top: `${levelPercent(level.value, chartLevelMin, chartLevelMax)}%` }}
                >
                  <div className={cn("border-t", level.line)} />
                  <button
                    type="button"
                    onClick={() => selectOrder(order)}
                    onPointerDown={(event) => {
                      if (level.draggable) beginLevelDrag(event, { kind: "order", orderId: order.id, field: level.field });
                    }}
                    className={cn(
                      "pointer-events-auto absolute left-3 -mt-3 rounded px-2 py-1 text-[10px] font-black shadow-lg transition-transform hover:scale-[1.03]",
                      level.draggable ? "cursor-ns-resize" : "cursor-pointer",
                      level.badge,
                      selectedOrder?.id === order.id && "ring-2 ring-white"
                    )}
                    title={level.draggable ? `Drag ${level.label}` : "Select order"}
                  >
                    {level.label} {order.side} {formatPrice(level.value, order.asset_id)}
                  </button>
                </div>
              ))))}
            </div>
            {selectedOrder ? (
              <div className="absolute left-4 top-16 z-20 w-[min(380px,calc(100%-2rem))] overflow-hidden rounded-xl border border-white/15 bg-[#111c24]/95 shadow-2xl backdrop-blur">
                <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black text-white">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeAsset.color }} />
                      {selectedOrder.asset_id} {formatLots(selectedOrder.size)} lots
                    </div>
                    <div className={cn("mt-1 text-xs font-semibold", selectedOrder.side === "BUY" ? "text-cyan-200" : "text-red-200")}>
                      {selectedOrder.status === "PENDING" ? `Pending ${selectedOrder.side}` : selectedOrder.side} at {formatPrice(selectedOrder.entry, selectedOrder.asset_id)}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    {selectedOrder.status === "OPEN" ? (
                      <div className={cn("font-mono text-sm font-black", (selectedFloatingPnl ?? 0) >= 0 ? "text-emerald-300" : "text-red-300")}>
                        {formatMoney(selectedFloatingPnl, displayAccount?.currency ?? "USD")}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSelectedOrderId("")}
                      className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-white/10 hover:text-white"
                      aria-label="Close order editor"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 border-b border-white/10 bg-black/20 text-xs font-bold text-slate-400">
                  <button type="button" className="h-10 bg-white/10 text-white">Modify</button>
                  <button
                    type="button"
                    onClick={() => closeSizeValid && closeOrder(selectedOrder.id, Number(orderEdit.closeSize))}
                    disabled={!closeSizeValid || closingOrderId === selectedOrder.id}
                    className="h-10 transition-colors hover:text-white disabled:opacity-40"
                  >
                    Partial close
                  </button>
                  <button
                    type="button"
                    onClick={() => closeOrder(selectedOrder.id)}
                    disabled={closingOrderId === selectedOrder.id}
                    className="h-10 transition-colors hover:text-white disabled:opacity-40"
                  >
                    {selectedOrder.status === "PENDING" ? "Cancel" : "Close"}
                  </button>
                </div>

                <div className="space-y-3 p-4">
                  {selectedOrderIsPending ? (
                    <label className="block text-xs font-semibold text-slate-400">
                      Pending entry
                      <input
                        value={orderEdit.entry}
                        onChange={(event) => setOrderEdit((current) => ({ ...current, entry: event.target.value }))}
                        className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 font-mono text-sm text-white outline-none focus:border-cyan-300/40"
                        inputMode="decimal"
                      />
                    </label>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-semibold text-slate-400">
                      Take profit
                      <input
                        value={orderEdit.takeProfit}
                        onChange={(event) => setOrderEdit((current) => ({ ...current, takeProfit: event.target.value }))}
                        className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 font-mono text-sm text-emerald-100 outline-none focus:border-cyan-300/40"
                        inputMode="decimal"
                      />
                    </label>
                    <label className="block text-xs font-semibold text-slate-400">
                      Stop loss
                      <input
                        value={orderEdit.stopLoss}
                        onChange={(event) => setOrderEdit((current) => ({ ...current, stopLoss: event.target.value }))}
                        className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 font-mono text-sm text-red-100 outline-none focus:border-cyan-300/40"
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-semibold text-slate-400">
                      {selectedOrderIsPending ? "Volume" : "Close volume"}
                      <input
                        value={selectedOrderIsPending ? orderEdit.size : orderEdit.closeSize}
                        onChange={(event) => {
                          const key = selectedOrderIsPending ? "size" : "closeSize";
                          setOrderEdit((current) => ({ ...current, [key]: event.target.value }));
                        }}
                        className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 font-mono text-sm text-white outline-none focus:border-cyan-300/40"
                        inputMode="decimal"
                      />
                    </label>
                    <div className="rounded-lg bg-black/25 p-3 text-xs">
                      <div className="text-slate-500">Current price</div>
                      <div className="mt-1 font-mono font-black text-white">{formatPrice(selectedExitPrice, selectedOrder.asset_id)}</div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={modifySelectedOrder}
                    disabled={!editValid || modifyingOrder}
                    className="h-11 w-full rounded-lg bg-amber-300 font-black text-slate-950 hover:bg-amber-200"
                  >
                    {modifyingOrder ? "Modifying..." : "Modify position"}
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="absolute bottom-4 left-4 z-10 w-[min(360px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#05080c]/92 shadow-2xl backdrop-blur">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-slate-400">
                <span>AI capture chart</span>
                <span className="text-cyan-200">{nativeChartImage ? "ready" : "syncing"}</span>
              </div>
              <LiveSmcChart
                candles={(activeSnapshot as any)?.candles ?? []}
                height={154}
                onSnapshot={setNativeChartImage}
              />
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
                  <div className="mt-1 font-mono text-lg font-black text-white">{formatPrice(bidAsk.bid, activeAsset.id)}</div>
                </div>
                <div className="rounded-xl bg-black/25 p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Ask</div>
                  <div className="mt-1 font-mono text-lg font-black text-white">{formatPrice(bidAsk.ask, activeAsset.id)}</div>
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
                  ["Balance", formatMoney(displayAccount?.balance, displayAccount?.currency ?? "USD")],
                  ["Equity", formatMoney(displayAccount?.equity, displayAccount?.currency ?? "USD")],
                  ["Free margin", formatMoney(displayAccount?.free_margin, displayAccount?.currency ?? "USD")],
                  ["Margin", formatMoney(displayAccount?.margin, displayAccount?.currency ?? "USD")],
                  ["Leverage", `1:${appliedLeverage}`],
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
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <select
                  value={appliedLeverage}
                  onChange={(event) => saveSettings({ leverage: Number(event.target.value) })}
                  className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm font-semibold text-white outline-none focus:border-cyan-300/40"
                >
                  {[20, 50, 100, 200, 500, 1000].map((value) => (
                    <option key={value} value={value}>1:{value}</option>
                  ))}
                </select>
                <div className="grid h-10 place-items-center rounded-lg bg-black/20 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Margin
                </div>
              </div>
            </div>

            <div className="border-b border-[#243440] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Bot className="h-4 w-4 text-cyan-200" />
                  Google AI analyst
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
                      <div className="truncate font-mono text-xs text-white">{formatPrice(value as number | null, activeAsset.id)}</div>
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
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <CircleDollarSign className="h-4 w-4 text-amber-200" />
                  New order
                </div>
                <span className={cn(
                  "rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em]",
                  ticketValid ? "bg-emerald-300/15 text-emerald-100" : "bg-amber-300/10 text-amber-100"
                )}>
                  {ticketValid ? "Ready" : "Check levels"}
                </span>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-2">
                <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[11px] text-slate-500">
                  <span>{activeAsset.name}</span>
                  <span>Regular demo form</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => updateTicketSide("SELL")}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      ticket.side === "SELL"
                        ? "border-red-300/45 bg-red-400/15"
                        : "border-white/10 bg-white/[0.03] hover:border-red-300/25"
                    )}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-300">Sell</div>
                    <div className="mt-1 font-mono text-lg font-black text-red-100">{formatPrice(bidAsk.bid, activeAsset.id)}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateTicketSide("BUY")}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      ticket.side === "BUY"
                        ? "border-cyan-300/45 bg-cyan-300/15"
                        : "border-white/10 bg-white/[0.03] hover:border-cyan-300/25"
                    )}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200">Buy</div>
                    <div className="mt-1 font-mono text-lg font-black text-cyan-50">{formatPrice(bidAsk.ask, activeAsset.id)}</div>
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 rounded-lg border border-white/10 bg-[#0c151c] p-1">
                  {(["market", "pending"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setOrderMode(mode)}
                      className={cn(
                        "h-9 rounded-md text-xs font-bold capitalize transition-colors",
                        orderMode === mode ? "bg-white/10 text-white" : "text-slate-500 hover:text-white"
                      )}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                <div className="mt-3 space-y-3">
                  <label className="block text-xs font-semibold text-slate-400">
                    Volume
                    <div className="mt-1 grid grid-cols-[1fr_auto_auto] overflow-hidden rounded-lg border border-white/10 bg-black/25">
                      <input
                        value={ticket.size}
                        onChange={(event) => setTicket((current) => ({ ...current, size: event.target.value }))}
                        className="h-10 min-w-0 bg-transparent px-3 font-mono text-sm text-white outline-none"
                        inputMode="decimal"
                      />
                      <span className="grid h-10 place-items-center px-3 text-[10px] uppercase tracking-[0.16em] text-slate-500">Lots</span>
                      <div className="flex border-l border-white/10">
                        <button type="button" onClick={() => stepSize(-0.01)} className="grid h-10 w-9 place-items-center text-slate-400 hover:text-white" aria-label="Decrease lot size">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => stepSize(0.01)} className="grid h-10 w-9 place-items-center border-l border-white/10 text-slate-400 hover:text-white" aria-label="Increase lot size">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </label>

                  <label className="block text-xs font-semibold text-slate-400">
                    {orderMode === "market" ? "Execution price" : "Pending entry"}
                    <input
                      value={ticket.entry}
                      onChange={(event) => setTicket((current) => ({ ...current, entry: event.target.value }))}
                      disabled={orderMode === "market"}
                      className={cn(
                        "mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 font-mono text-sm text-white outline-none focus:border-cyan-300/40",
                        orderMode === "market" && "cursor-not-allowed text-slate-400"
                      )}
                      inputMode="decimal"
                    />
                  </label>

                  {[
                    ["stopLoss", "Stop loss", "text-red-200"],
                    ["takeProfit", "Take profit", "text-emerald-200"],
                  ].map(([key, label, tone]) => (
                    <label key={key} className="block text-xs font-semibold text-slate-400">
                      {label}
                      <input
                        value={ticket[key as keyof typeof ticket]}
                        onChange={(event) => setTicket((current) => ({ ...current, [key]: event.target.value }))}
                        className={cn("mt-1 h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 font-mono text-sm outline-none focus:border-cyan-300/40", tone)}
                        inputMode="decimal"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-white/[0.04] p-2">
                    <div className="text-slate-500">Margin</div>
                    <div className="mt-1 font-mono text-white">{formatMoney(ticketMargin, displayAccount?.currency ?? "USD")}</div>
                  </div>
                  <div className="rounded-lg bg-white/[0.04] p-2">
                    <div className="text-slate-500">R:R</div>
                    <div className="mt-1 font-mono text-white">{ticketRr ? `1:${ticketRr}` : "-"}</div>
                  </div>
                  <div className="rounded-lg bg-red-400/[0.06] p-2">
                    <div className="text-slate-500">Est risk</div>
                    <div className="mt-1 font-mono text-red-100">{formatMoney(ticketRisk, displayAccount?.currency ?? "USD")}</div>
                  </div>
                  <div className="rounded-lg bg-emerald-300/[0.06] p-2">
                    <div className="text-slate-500">Est reward</div>
                    <div className="mt-1 font-mono text-emerald-100">{formatMoney(ticketReward, displayAccount?.currency ?? "USD")}</div>
                  </div>
                </div>
              </div>

              <Button
                type="button"
                onClick={placeOrder}
                disabled={!ticketValid || placingOrder}
                className={cn(
                  "mt-4 h-12 w-full rounded-xl text-slate-950",
                  ticket.side === "BUY"
                    ? "bg-cyan-300 hover:bg-cyan-200"
                    : "bg-red-300 hover:bg-red-200"
                )}
              >
                {placingOrder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                {placingOrder ? "Sending..." : `Place ${orderMode} ${ticket.side}`}
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
                ["PENDING", `Pending ${pendingOrders.length}`],
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
                      <td className="px-4 py-3 font-mono">{formatLots(order.size)}</td>
                      <td className="px-4 py-3 font-mono">{formatPrice(order.entry, order.asset_id)}</td>
                      <td className="px-4 py-3 font-mono text-red-300">{formatPrice(order.stop_loss, order.asset_id)}</td>
                      <td className="px-4 py-3 font-mono text-emerald-300">{formatPrice(order.take_profit, order.asset_id)}</td>
                      <td className="px-4 py-3">{order.status}</td>
                      <td className={cn("px-4 py-3 font-mono", (order.pnl ?? 0) >= 0 ? "text-emerald-300" : "text-red-300")}>
                        {order.pnl == null ? "-" : formatMoney(order.pnl, displayAccount?.currency ?? "USD")}
                      </td>
                      <td className="px-4 py-3">
                        {order.status === "OPEN" || order.status === "PENDING" ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => selectOrder(order)}
                              className={cn(
                                "rounded border px-2 py-1 transition-colors hover:border-cyan-300/30 hover:text-white",
                                selectedOrder?.id === order.id
                                  ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                                  : "border-white/10 text-slate-400"
                              )}
                            >
                              Modify
                            </button>
                            <button
                              type="button"
                              onClick={() => closeOrder(order.id)}
                              disabled={closingOrderId === order.id}
                              className="rounded border border-white/10 px-2 py-1 text-slate-400 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
                            >
                              {order.status === "PENDING" ? "Cancel" : "Close"}
                            </button>
                          </div>
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
                {terminalTab === "PENDING" ? "No pending orders in this tab." : "No orders in this tab."}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-[#243440] px-3 py-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-4">
              <span>Equity: <strong className="font-mono text-white">{formatMoney(displayAccount?.equity, displayAccount?.currency ?? "USD")}</strong></span>
              <span>Free Margin: <strong className="font-mono text-white">{formatMoney(displayAccount?.free_margin, displayAccount?.currency ?? "USD")}</strong></span>
              <span>Margin Level: <strong className="font-mono text-white">{displayAccount?.margin_level ? `${displayAccount.margin_level.toFixed(2)}%` : "-"}</strong></span>
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
