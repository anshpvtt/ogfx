"""Signal generator — the main real-time loop that orchestrates everything."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict

from services.market_data import fetch_ohlcv, get_latest_snapshot
from services.ai_engine import analyze_with_ai
from services.telegram_bot import send_telegram_signal, send_telegram_error
from services.database import insert_signal, get_signals
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

STRATEGIES_PATH = Path(__file__).parent.parent / "data" / "strategies.json"

# Rate-limiting: track signal counts per hour per symbol
_signal_counts: defaultdict[str, list] = defaultdict(list)


def _load_strategies() -> list[dict]:
    with open(STRATEGIES_PATH, "r") as f:
        return json.load(f)


def _is_rate_limited(symbol: str) -> bool:
    """Prevent more than max_signals_per_hour per symbol per hour."""
    now = datetime.now(timezone.utc)
    cutoff = now.timestamp() - 3600
    _signal_counts[symbol] = [t for t in _signal_counts[symbol] if t > cutoff]
    return len(_signal_counts[symbol]) >= settings.max_signals_per_hour


def _record_signal(symbol: str) -> None:
    _signal_counts[symbol].append(datetime.now(timezone.utc).timestamp())


async def run_signal_cycle(symbol: str, strategies: list[dict]) -> dict | None:
    """Run one complete signal generation cycle for a single symbol."""
    if _is_rate_limited(symbol):
        logger.info(f"[{symbol}] Rate limited — skipping this cycle")
        return None

    # 1. Fetch market data
    df = fetch_ohlcv(symbol, period="5d", interval="1h")
    if df is None:
        logger.warning(f"[{symbol}] No data available")
        return None

    snapshot = get_latest_snapshot(df)
    logger.debug(f"[{symbol}] Snapshot: close={snapshot['close']:.5f} RSI={snapshot['rsi']:.1f} "
                 f"EMA200={'above' if snapshot['above_ema200'] else 'below'}")

    # 2. AI Analysis
    signal = await analyze_with_ai(symbol, snapshot, strategies)
    signal["symbol"] = symbol
    signal["rsi"] = snapshot["rsi"]
    signal["ema_50"] = snapshot["ema_50"]
    signal["ema_200"] = snapshot["ema_200"]
    signal["macd"] = snapshot["macd"]

    logger.info(f"[{symbol}] AI → {signal['signal']} ({signal['confidence']}%) — {signal['reason'][:80]}")

    # 3. Only persist + notify actionable signals
    if signal["signal"] in ("BUY", "SELL") and signal["confidence"] >= settings.min_confidence_threshold:
        try:
            saved = await insert_signal(signal)
            signal["id"] = saved.get("id")
            _record_signal(symbol)
        except Exception as e:
            logger.error(f"[{symbol}] DB insert failed: {e}")
            await send_telegram_error(f"DB insert failed for {symbol}: {e}")

        # 4. Send Telegram notification (non-blocking)
        asyncio.create_task(send_telegram_signal(signal))

    return signal


async def run_all_symbols() -> list[dict]:
    """Run signal cycles for all configured instruments concurrently."""
    strategies = _load_strategies()
    tasks = [
        run_signal_cycle(sym, strategies)
        for sym in settings.instruments
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    signals = []
    for r in results:
        if isinstance(r, Exception):
            logger.error(f"Signal cycle exception: {r}")
        elif r is not None:
            signals.append(r)
    return signals
