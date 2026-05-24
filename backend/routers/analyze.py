"""FastAPI router — /analyze endpoint (on-demand AI analysis)."""

import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
from services.market_data import fetch_ohlcv, get_latest_snapshot
from services.ai_engine import analyze_with_ai

router = APIRouter(prefix="/analyze", tags=["analyze"])
STRATEGIES_PATH = Path(__file__).parent.parent / "data" / "strategies.json"


def _load_strategies():
    with open(STRATEGIES_PATH) as f:
        return json.load(f)


class AnalyzeRequest(BaseModel):
    symbol: str
    strategy_ids: Optional[list[str]] = None  # Filter specific strategies


@router.post("/")
async def analyze_symbol(req: AnalyzeRequest):
    """Run an on-demand AI analysis for a given symbol."""
    valid_symbols = ["EURUSD", "GBPUSD", "XAUUSD", "BTCUSDT"]
    if req.symbol not in valid_symbols:
        raise HTTPException(status_code=400, detail=f"Symbol must be one of {valid_symbols}")

    df = fetch_ohlcv(req.symbol, period="5d", interval="1h")
    if df is None:
        raise HTTPException(status_code=503, detail="Failed to fetch market data")

    snapshot = get_latest_snapshot(df)
    strategies = _load_strategies()

    if req.strategy_ids:
        strategies = [s for s in strategies if s["id"] in req.strategy_ids]
        if not strategies:
            raise HTTPException(status_code=400, detail="No matching strategy IDs found")

    result = await analyze_with_ai(req.symbol, snapshot, strategies)
    result["snapshot"] = snapshot
    return result


@router.get("/strategies")
async def list_strategies():
    """Return the full strategy dataset."""
    return {"strategies": _load_strategies()}
