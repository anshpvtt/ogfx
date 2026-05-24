"""MT5 Bridge — connects to MetaTrader 5 on Exness and executes signals from Supabase."""

import os
import time
import logging
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

from mt5_connector import MT5Connector
from order_manager import OrderManager
from duplicate_guard import DuplicateGuard
from logger import setup_logger

setup_logger()
logger = logging.getLogger("ogfx.bridge")

# ── Config ────────────────────────────────────────────────────────
SUPABASE_URL       = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY       = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
BACKEND_API_URL    = os.getenv("BACKEND_API_URL", "http://localhost:8000")
BACKEND_API_KEY    = os.getenv("API_KEY", "")
POLL_INTERVAL      = int(os.getenv("POLL_INTERVAL_SECONDS", "5"))
MAX_TRADES_PER_DAY = int(os.getenv("MAX_TRADES_PER_DAY", "10"))
RISK_PERCENT       = float(os.getenv("RISK_PERCENT", "1.5"))

# ── Validate Supabase ─────────────────────────────────────────────
if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")

from supabase import create_client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_pending_signals() -> list[dict]:
    """Query Supabase for signals that are still pending."""
    try:
        result = (
            supabase.table("signals")
            .select("*")
            .eq("status", "pending")
            .in_("signal", ["BUY", "SELL"])
            .gte("confidence", 70)
            .order("created_at", desc=False)
            .limit(20)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error(f"Failed to fetch pending signals: {e}")
        return []


def mark_signal(signal_id: str, status: str) -> None:
    try:
        supabase.table("signals").update({"status": status}).eq("id", signal_id).execute()
    except Exception as e:
        logger.warning(f"Could not update signal {signal_id} → {status}: {e}")


def record_trade(signal: dict, ticket: int, lot_size: float) -> None:
    try:
        supabase.table("trades").insert({
            "signal_id":   signal["id"],
            "symbol":      signal["symbol"],
            "direction":   signal["signal"],
            "entry_price": signal.get("entry_price") or 0,
            "stop_loss":   signal.get("stop_loss") or 0,
            "take_profit": signal.get("take_profit") or 0,
            "lot_size":    lot_size,
            "status":      "open",
            "mt5_ticket":  ticket,
            "opened_at":   datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        logger.error(f"Failed to record trade in DB: {e}")


def count_today_trades() -> int:
    try:
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        result = supabase.table("trades").select("id", count="exact").gte("opened_at", today_start).execute()
        return result.count or 0
    except Exception:
        return 0


def main():
    logger.info("=" * 60)
    logger.info("  OGFX MT5 Bridge — Starting")
    logger.info("=" * 60)

    connector = MT5Connector()
    if not connector.initialize():
        logger.error("MT5 initialization failed. Exiting.")
        return

    order_mgr  = OrderManager(connector, risk_percent=RISK_PERCENT)
    dup_guard  = DuplicateGuard()

    logger.info(f"✅ MT5 connected | Account: {connector.get_account_info()}")
    logger.info(f"📡 Polling Supabase every {POLL_INTERVAL}s for pending signals")

    while True:
        try:
            # Daily trade limit
            today_count = count_today_trades()
            if today_count >= MAX_TRADES_PER_DAY:
                logger.info(f"🚫 Daily limit reached ({today_count}/{MAX_TRADES_PER_DAY}). Waiting…")
                time.sleep(60)
                continue

            signals = fetch_pending_signals()
            if not signals:
                time.sleep(POLL_INTERVAL)
                continue

            logger.info(f"📥 Found {len(signals)} pending signal(s)")

            for signal in signals:
                sid      = signal["id"]
                symbol   = signal["symbol"]
                direction = signal["signal"]

                # Duplicate check
                if dup_guard.is_duplicate(sid):
                    logger.debug(f"Skipping duplicate signal {sid}")
                    mark_signal(sid, "cancelled")
                    continue

                logger.info(f"⚡ Processing: {direction} {symbol} | Confidence={signal['confidence']}%")

                # Execute order
                result = order_mgr.execute(signal)

                if result["success"]:
                    ticket    = result["ticket"]
                    lot_size  = result["lot_size"]
                    dup_guard.mark_executed(sid)
                    mark_signal(sid, "executed")
                    record_trade(signal, ticket, lot_size)
                    logger.info(f"✅ Order placed | Ticket={ticket} | Lots={lot_size}")
                else:
                    logger.warning(f"❌ Order failed: {result['error']}")
                    if result.get("fatal"):
                        mark_signal(sid, "failed")
                    # Non-fatal errors: leave as pending for next cycle

        except KeyboardInterrupt:
            logger.info("Bridge stopped by user.")
            break
        except Exception as e:
            logger.error(f"Bridge loop error: {e}", exc_info=True)

        time.sleep(POLL_INTERVAL)

    connector.shutdown()


if __name__ == "__main__":
    main()
