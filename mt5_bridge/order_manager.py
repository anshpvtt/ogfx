"""Order manager — position sizing, order execution with retry logic."""

import logging
import time
import MetaTrader5 as mt5
from mt5_connector import MT5Connector, SYMBOL_MAP

logger = logging.getLogger("ogfx.orders")

MAX_RETRIES  = 3
RETRY_DELAY  = 2   # seconds
MAGIC_NUMBER = 234000
DEVIATION    = 20   # max slippage in points


class OrderManager:
    def __init__(self, connector: MT5Connector, risk_percent: float = 1.5):
        self.connector    = connector
        self.risk_percent = risk_percent / 100.0

    # ─── Lot Sizing ────────────────────────────────────────────────────
    def _calculate_lot(self, ogfx_symbol: str, entry: float, stop_loss: float) -> float:
        """Risk-based position sizing: risk% of balance / SL in account currency."""
        account = self.connector.get_account_info()
        balance = account.get("balance", 1000.0)
        risk_amount = balance * self.risk_percent

        sym_info = self.connector.get_symbol_info(ogfx_symbol)
        if sym_info is None:
            logger.warning(f"Cannot get symbol info for {ogfx_symbol}, using 0.01 lot")
            return 0.01

        sl_distance_points = abs(entry - stop_loss)
        if sl_distance_points == 0:
            return 0.01

        # pip_value differs by instrument
        pip_value = sym_info.trade_tick_value   # value of 1 tick (minimum move) in account currency
        tick_size = sym_info.trade_tick_size
        sl_ticks  = sl_distance_points / tick_size if tick_size else 0

        if sl_ticks == 0 or pip_value == 0:
            return 0.01

        lot = risk_amount / (sl_ticks * pip_value)
        lot = round(max(sym_info.volume_min, min(sym_info.volume_max, lot)), 2)
        logger.info(f"Lot size calc: balance={balance:.2f} risk={risk_amount:.2f} sl_ticks={sl_ticks:.1f} → {lot} lots")
        return lot

    # ─── Execution ─────────────────────────────────────────────────────
    def execute(self, signal: dict) -> dict:
        """Execute a trading signal with retry logic. Returns result dict."""
        ogfx_symbol = signal["symbol"]
        direction   = signal["signal"]
        mt5_symbol  = SYMBOL_MAP.get(ogfx_symbol, ogfx_symbol)

        # Ensure symbol is selected in Market Watch
        mt5.symbol_select(mt5_symbol, True)

        tick = self.connector.get_symbol_price(ogfx_symbol)
        if tick is None:
            return {"success": False, "error": "No tick data", "fatal": False}

        entry = tick["ask"] if direction == "BUY" else tick["bid"]

        # Use AI-suggested SL/TP if available, otherwise auto-calculate from ATR approx
        sl = signal.get("stop_loss")
        tp = signal.get("take_profit")

        if not sl or sl == 0:
            sym_info = self.connector.get_symbol_info(ogfx_symbol)
            atr_approx = entry * 0.002  # 0.2% fallback approximation
            sl = entry - atr_approx if direction == "BUY" else entry + atr_approx
            tp = entry + atr_approx * 2 if direction == "BUY" else entry - atr_approx * 2

        lot = self._calculate_lot(ogfx_symbol, entry, sl)

        order_type = mt5.ORDER_TYPE_BUY if direction == "BUY" else mt5.ORDER_TYPE_SELL

        request = {
            "action":       mt5.TRADE_ACTION_DEAL,
            "symbol":       mt5_symbol,
            "volume":       lot,
            "type":         order_type,
            "price":        entry,
            "sl":           round(sl, 5),
            "tp":           round(tp, 5),
            "deviation":    DEVIATION,
            "magic":        MAGIC_NUMBER,
            "comment":      f"ogfx_{signal.get('strategy_id', 'ai')[:10]}",
            "type_time":    mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        for attempt in range(1, MAX_RETRIES + 1):
            logger.info(f"Order attempt {attempt}/{MAX_RETRIES}: {direction} {lot} {mt5_symbol} @ {entry:.5f}")
            result = self.connector.send_order(request)

            if result is None:
                err = str(mt5.last_error())
                logger.warning(f"Attempt {attempt} — result is None: {err}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY)
                continue

            if result.retcode == mt5.TRADE_RETCODE_DONE:
                logger.info(f"✅ SUCCESS — ticket={result.order} deal={result.deal}")
                return {
                    "success":  True,
                    "ticket":   result.order,
                    "deal":     result.deal,
                    "lot_size": lot,
                    "retcode":  result.retcode,
                }

            # Retryable errors
            retryable = {
                mt5.TRADE_RETCODE_REQUOTE,
                mt5.TRADE_RETCODE_PRICE_CHANGED,
                mt5.TRADE_RETCODE_PRICE_OFF,
                mt5.TRADE_RETCODE_TIMEOUT,
                mt5.TRADE_RETCODE_CONNECTION,
            }
            if result.retcode in retryable:
                logger.warning(f"Retryable error {result.retcode}: {result.comment}")
                # Refresh price for next attempt
                tick = self.connector.get_symbol_price(ogfx_symbol)
                if tick:
                    request["price"] = tick["ask"] if direction == "BUY" else tick["bid"]
                time.sleep(RETRY_DELAY)
            else:
                logger.error(f"Fatal order error {result.retcode}: {result.comment}")
                return {"success": False, "error": result.comment, "retcode": result.retcode, "fatal": True}

        return {"success": False, "error": f"Failed after {MAX_RETRIES} attempts", "fatal": False}
