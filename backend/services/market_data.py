"""Market data fetcher — OHLCV + technical indicators for all instruments."""

import logging
from datetime import datetime, timezone
from typing import Optional
import numpy as np
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

# Map OGFX symbols → yfinance tickers
SYMBOL_MAP = {
    "EURUSD":  "EURUSD=X",
    "GBPUSD":  "GBPUSD=X",
    "XAUUSD":  "GC=F",
    "BTCUSDT": "BTC-USD",
}


def _ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(span=period, adjust=False).mean()
    avg_loss = loss.ewm(span=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - (100 / (1 + rs))).fillna(50)


def _macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = _ema(series, fast)
    ema_slow = _ema(series, slow)
    macd_line = ema_fast - ema_slow
    signal_line = _ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


def fetch_ohlcv(symbol: str, period: str = "5d", interval: str = "1h") -> Optional[pd.DataFrame]:
    """Download OHLCV data from Yahoo Finance and compute indicators."""
    ticker = SYMBOL_MAP.get(symbol)
    if not ticker:
        logger.warning(f"Unknown symbol: {symbol}")
        return None

    try:
        df = yf.download(ticker, period=period, interval=interval, progress=False, auto_adjust=True)
        if df.empty or len(df) < 50:
            logger.warning(f"Insufficient data for {symbol} ({len(df)} rows)")
            return None

        # Flatten multi-index columns if present
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)

        df = df.rename(columns={"Open": "open", "High": "high", "Low": "low",
                                 "Close": "close", "Volume": "volume"})
        df.dropna(subset=["close"], inplace=True)

        # ── Indicators ───────────────────────────────────────────────
        df["ema_50"]  = _ema(df["close"], 50)
        df["ema_200"] = _ema(df["close"], 200)
        df["rsi"]     = _rsi(df["close"], 14)
        df["atr"]     = _atr(df["high"], df["low"], df["close"], 14)

        macd_line, signal_line, histogram = _macd(df["close"])
        df["macd"]          = macd_line
        df["macd_signal"]   = signal_line
        df["macd_hist"]     = histogram

        # ── Market Structure ─────────────────────────────────────────
        df["swing_high"] = df["high"].rolling(5, center=True).max() == df["high"]
        df["swing_low"]  = df["low"].rolling(5, center=True).min() == df["low"]

        return df

    except Exception as exc:
        logger.error(f"Failed to fetch data for {symbol}: {exc}")
        return None


def get_latest_snapshot(df: pd.DataFrame) -> dict:
    """Extract the most recent row as a clean dict for AI / strategy evaluation."""
    row = df.iloc[-1]
    prev = df.iloc[-2]

    return {
        "timestamp": str(df.index[-1]),
        "open":      float(row.get("open",  0)),
        "high":      float(row.get("high",  0)),
        "low":       float(row.get("low",   0)),
        "close":     float(row.get("close", 0)),
        "volume":    float(row.get("volume", 0)),
        "ema_50":    float(row.get("ema_50",  0)),
        "ema_200":   float(row.get("ema_200", 0)),
        "rsi":       float(row.get("rsi",     50)),
        "macd":      float(row.get("macd",    0)),
        "macd_signal": float(row.get("macd_signal", 0)),
        "macd_hist": float(row.get("macd_hist", 0)),
        "atr":       float(row.get("atr",     0)),
        # Derived
        "above_ema200": bool(row["close"] > row["ema_200"]),
        "above_ema50":  bool(row["close"] > row["ema_50"]),
        "rsi_oversold":    bool(row["rsi"] < 35),
        "rsi_overbought":  bool(row["rsi"] > 65),
        "macd_bullish":    bool(row["macd_hist"] > 0 and row["macd_hist"] > prev.get("macd_hist", 0)),
        "macd_bearish":    bool(row["macd_hist"] < 0 and row["macd_hist"] < prev.get("macd_hist", 0)),
        "prev_close":      float(prev.get("close", 0)),
        "price_change_pct": float((row["close"] - prev["close"]) / prev["close"] * 100) if prev["close"] else 0,
    }
