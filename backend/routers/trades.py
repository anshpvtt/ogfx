"""FastAPI routers — /trades endpoints."""

from fastapi import APIRouter, Query, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
from services.database import get_trades, insert_trade, close_trade, get_stats
from config import get_settings

router = APIRouter(prefix="/trades", tags=["trades"])
settings = get_settings()
security = HTTPBearer(auto_error=False)


def _check_api_key(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if settings.environment == "development":
        return True
    if not creds or creds.credentials != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


class TradeCreate(BaseModel):
    signal_id: Optional[str] = None
    symbol: str
    direction: str
    entry_price: float
    stop_loss: float
    take_profit: float
    lot_size: float = 0.01


class TradeClose(BaseModel):
    exit_price: float
    pnl: float


@router.get("/")
async def list_trades(limit: int = Query(default=100, le=500)):
    """Get trade history."""
    trades = await get_trades(limit=limit)
    return {"trades": trades, "count": len(trades)}


@router.post("/")
async def create_trade(
    payload: TradeCreate,
    _: bool = Depends(_check_api_key),
):
    """Record a new open trade (called by MT5 bridge after execution)."""
    saved = await insert_trade(payload.model_dump())
    return {"status": "created", "trade": saved}


@router.patch("/{trade_id}/close")
async def close_trade_endpoint(
    trade_id: str,
    payload: TradeClose,
    _: bool = Depends(_check_api_key),
):
    """Mark a trade as closed with exit price and PnL."""
    await close_trade(trade_id, payload.exit_price, payload.pnl)
    return {"status": "closed", "trade_id": trade_id, "pnl": payload.pnl}


@router.get("/stats")
async def trading_stats():
    """Aggregate statistics across all trades."""
    return await get_stats()
