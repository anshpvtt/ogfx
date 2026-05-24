"""Telegram notification service — sends trading signal alerts."""

import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional
import httpx
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


def _signal_emoji(signal: str) -> str:
    return {"BUY": "🟢", "SELL": "🔴", "SKIP": "⏭️"}.get(signal, "⚪")


def _confidence_bar(confidence: int) -> str:
    filled = int(confidence / 10)
    empty = 10 - filled
    return "█" * filled + "░" * empty


def _format_signal_message(signal: dict) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    emoji = _signal_emoji(signal.get("signal", "SKIP"))
    conf = signal.get("confidence", 0)
    bar = _confidence_bar(conf)

    lines = [
        f"╔══════════════════════╗",
        f"║    🤖 OGFX AI SIGNAL    ║",
        f"╚══════════════════════╝",
        f"",
        f"{emoji} *{signal.get('signal', 'SKIP')}* — `{signal.get('symbol', '')}`",
        f"",
        f"📊 *Strategy:* {signal.get('strategy_name', 'N/A')}",
        f"🎯 *Confidence:* {conf}% `{bar}`",
        f"💡 *Reason:* {signal.get('reason', 'N/A')}",
        f"",
    ]

    if signal.get("entry_price"):
        lines += [
            f"💰 *Entry:*  `{signal['entry_price']:.5f}`",
            f"🛑 *Stop Loss:* `{signal['stop_loss']:.5f}`" if signal.get("stop_loss") else "",
            f"✅ *Take Profit:* `{signal['take_profit']:.5f}`" if signal.get("take_profit") else "",
            f"📐 *RR Ratio:* `1:{signal.get('risk_reward', 2.0):.1f}`",
            f"",
        ]

    key_factors = signal.get("key_factors", [])
    if key_factors:
        lines.append("🔑 *Key Factors:*")
        for factor in key_factors[:3]:
            lines.append(f"  • {factor}")
        lines.append("")

    lines.append(f"⏰ `{now}`")
    lines.append(f"🌐 _OGFX Algorithmic Trading_")

    return "\n".join(l for l in lines if l is not None)


async def send_telegram_signal(signal: dict) -> bool:
    """Send a formatted trading signal to the configured Telegram chat."""
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        logger.debug("Telegram not configured — skipping notification")
        return False

    # Only send actionable signals
    if signal.get("signal") == "SKIP":
        return False

    try:
        url = TELEGRAM_API.format(token=settings.telegram_bot_token)
        payload = {
            "chat_id": settings.telegram_chat_id,
            "text": _format_signal_message(signal),
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code == 200:
                logger.info(f"Telegram: sent {signal['signal']} alert for {signal.get('symbol')}")
                return True
            else:
                logger.warning(f"Telegram error {resp.status_code}: {resp.text}")
                return False
    except Exception as e:
        logger.error(f"Telegram send failed: {e}")
        return False


async def send_telegram_error(message: str) -> None:
    """Send an error notification to Telegram."""
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        return
    try:
        url = TELEGRAM_API.format(token=settings.telegram_bot_token)
        payload = {
            "chat_id": settings.telegram_chat_id,
            "text": f"⚠️ *OGFX System Error*\n\n`{message}`",
            "parse_mode": "Markdown",
        }
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload)
    except Exception:
        pass
