"""Duplicate guard — prevents re-executing the same signal multiple times."""

import time
import logging

logger = logging.getLogger("ogfx.duplicate")

# In-memory store: signal_id -> executed_timestamp
# Keeps last 1000 entries to prevent unbounded growth
_executed: dict[str, float] = {}
MAX_CACHE = 1000


class DuplicateGuard:
    def is_duplicate(self, signal_id: str) -> bool:
        return signal_id in _executed

    def mark_executed(self, signal_id: str) -> None:
        global _executed
        if len(_executed) >= MAX_CACHE:
            # Evict oldest half
            sorted_ids = sorted(_executed, key=lambda k: _executed[k])
            for sid in sorted_ids[:MAX_CACHE // 2]:
                del _executed[sid]
        _executed[signal_id] = time.time()
        logger.debug(f"Marked {signal_id} as executed. Cache size: {len(_executed)}")
