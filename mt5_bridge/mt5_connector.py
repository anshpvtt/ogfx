"""MT5 connector — wraps the MetaTrader5 Python API."""

import logging
import MetaTrader5 as mt5
import os

logger = logging.getLogger("ogfx.mt5")

# yfinance → MT5 symbol mapping (Exness uses these exact names)
SYMBOL_MAP = {
    "EURUSD":  "EURUSDm",   # Exness mini suffix — adjust to your account type
    "GBPUSD":  "GBPUSDm",
    "XAUUSD":  "XAUUSDm",
    "BTCUSDT": "BTCUSDTm",
}


class MT5Connector:
    def __init__(self):
        self.path  = os.getenv("MT5_PATH", "")          # e.g. C:\Program Files\Exness MT5\terminal64.exe
        self.login = int(os.getenv("MT5_LOGIN", "0"))
        self.password = os.getenv("MT5_PASSWORD", "")
        self.server   = os.getenv("MT5_SERVER", "")      # e.g. Exness-MT5Real8
        self._initialized = False

    def initialize(self) -> bool:
        kwargs = {}
        if self.path:
            kwargs["path"] = self.path
        if self.login and self.password and self.server:
            kwargs.update(login=self.login, password=self.password, server=self.server)

        if not mt5.initialize(**kwargs):
            error = mt5.last_error()
            logger.error(f"MT5 initialize() failed: {error}")
            return False

        self._initialized = True
        info = mt5.account_info()
        if info is None:
            logger.error("MT5 connected but account_info() returned None")
            return False

        logger.info(f"MT5 OK — Login={info.login} Server={info.server} Balance={info.balance:.2f}")
        return True

    def shutdown(self):
        if self._initialized:
            mt5.shutdown()
            self._initialized = False
            logger.info("MT5 disconnected.")

    def get_account_info(self) -> dict:
        info = mt5.account_info()
        if info is None:
            return {}
        return {
            "login":    info.login,
            "server":   info.server,
            "balance":  info.balance,
            "equity":   info.equity,
            "margin":   info.margin,
            "free_margin": info.margin_free,
            "currency": info.currency,
            "leverage": info.leverage,
        }

    def get_symbol_price(self, ogfx_symbol: str) -> dict | None:
        mt5_sym = SYMBOL_MAP.get(ogfx_symbol, ogfx_symbol)
        tick = mt5.symbol_info_tick(mt5_sym)
        if tick is None:
            logger.warning(f"No tick data for {mt5_sym}")
            return None
        return {"bid": tick.bid, "ask": tick.ask, "symbol": mt5_sym}

    def get_symbol_info(self, ogfx_symbol: str) -> mt5.SymbolInfo | None:
        mt5_sym = SYMBOL_MAP.get(ogfx_symbol, ogfx_symbol)
        info = mt5.symbol_info(mt5_sym)
        if info is None:
            logger.warning(f"Symbol info not found for {mt5_sym}")
        return info

    def send_order(self, request: dict) -> mt5.OrderSendResult:
        """Send an order request and return the raw MT5 result."""
        return mt5.order_send(request)

    def get_open_positions(self) -> list:
        positions = mt5.positions_get()
        return list(positions) if positions else []

    def close_position(self, position) -> bool:
        """Close an open position by sending an opposite order."""
        sym  = position.symbol
        tick = mt5.symbol_info_tick(sym)
        if tick is None:
            return False
        price = tick.ask if position.type == mt5.ORDER_TYPE_SELL else tick.bid
        request = {
            "action":    mt5.TRADE_ACTION_DEAL,
            "symbol":    sym,
            "volume":    position.volume,
            "type":      mt5.ORDER_TYPE_BUY if position.type == mt5.ORDER_TYPE_SELL else mt5.ORDER_TYPE_SELL,
            "position":  position.ticket,
            "price":     price,
            "deviation": 20,
            "magic":     234000,
            "comment":   "ogfx_close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        result = mt5.order_send(request)
        return result.retcode == mt5.TRADE_RETCODE_DONE
