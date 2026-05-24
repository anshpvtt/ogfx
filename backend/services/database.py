"""Supabase database service — signals, trades, strategies."""

import logging
from datetime import datetime, timezone
from typing import Optional
from supabase import create_client, Client
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_client: Optional[Client] = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise RuntimeError("Supabase credentials not configured in .env")
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


# ─── Signals ────────────────────────────────────────────────────────────────

async def insert_signal(signal: dict) -> dict:
    """Insert a new signal row and return the created record."""
    db = get_supabase()
    payload = {
        "symbol": signal["symbol"],
        "signal": signal["signal"],          # BUY | SELL | SKIP
        "confidence": signal["confidence"],
        "reason": signal["reason"],
        "strategy_id": signal.get("strategy_id", ""),
        "strategy_name": signal.get("strategy_name", ""),
        "entry_price": signal.get("entry_price"),
        "stop_loss": signal.get("stop_loss"),
        "take_profit": signal.get("take_profit"),
        "rsi": signal.get("rsi"),
        "ema_50": signal.get("ema_50"),
        "ema_200": signal.get("ema_200"),
        "macd": signal.get("macd"),
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = db.table("signals").insert(payload).execute()
    return result.data[0] if result.data else payload


async def get_signals(limit: int = 50, symbol: Optional[str] = None) -> list[dict]:
    """Fetch latest signals, optionally filtered by symbol."""
    db = get_supabase()
    query = db.table("signals").select("*").order("created_at", desc=True).limit(limit)
    if symbol:
        query = query.eq("symbol", symbol)
    result = query.execute()
    return result.data or []


async def update_signal_status(signal_id: str, status: str) -> None:
    db = get_supabase()
    db.table("signals").update({"status": status}).eq("id", signal_id).execute()


# ─── Trades ─────────────────────────────────────────────────────────────────

async def insert_trade(trade: dict) -> dict:
    db = get_supabase()
    payload = {
        "signal_id": trade.get("signal_id"),
        "symbol": trade["symbol"],
        "direction": trade["direction"],
        "entry_price": trade["entry_price"],
        "stop_loss": trade["stop_loss"],
        "take_profit": trade["take_profit"],
        "lot_size": trade.get("lot_size", 0.01),
        "status": "open",
        "opened_at": datetime.now(timezone.utc).isoformat(),
    }
    result = db.table("trades").insert(payload).execute()
    return result.data[0] if result.data else payload


async def get_trades(limit: int = 100) -> list[dict]:
    db = get_supabase()
    result = db.table("trades").select("*").order("opened_at", desc=True).limit(limit).execute()
    return result.data or []


async def close_trade(trade_id: str, exit_price: float, pnl: float) -> None:
    db = get_supabase()
    db.table("trades").update({
        "exit_price": exit_price,
        "pnl": pnl,
        "status": "closed",
        "closed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", trade_id).execute()


# ─── Stats ──────────────────────────────────────────────────────────────────

async def get_stats() -> dict:
    """Compute aggregate stats from closed trades."""
    db = get_supabase()
    trades = db.table("trades").select("pnl, status").execute().data or []
    closed = [t for t in trades if t["status"] == "closed"]
    wins = [t for t in closed if (t.get("pnl") or 0) > 0]
    total_pnl = sum(t.get("pnl") or 0 for t in closed)
    win_rate = (len(wins) / len(closed) * 100) if closed else 0

    signals_today = db.table("signals") \
        .select("id", count="exact") \
        .gte("created_at", datetime.now(timezone.utc).replace(hour=0, minute=0, second=0).isoformat()) \
        .execute()

    return {
        "total_trades": len(trades),
        "closed_trades": len(closed),
        "open_trades": len([t for t in trades if t["status"] == "open"]),
        "win_rate": round(win_rate, 2),
        "total_pnl": round(total_pnl, 4),
        "signals_today": signals_today.count or 0,
    }
