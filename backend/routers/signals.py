"""FastAPI routers — /signals endpoints."""

from fastapi import APIRouter, Query, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional
from services.database import get_signals, insert_signal, update_signal_status
from config import get_settings

router = APIRouter(prefix="/signals", tags=["signals"])
settings = get_settings()
security = HTTPBearer(auto_error=False)


def _check_api_key(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if settings.environment == "development":
        return True
    if not creds or creds.credentials != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


class SignalCreate(BaseModel):
    symbol: str
    signal: str
    confidence: int
    reason: str
    strategy_id: Optional[str] = None
    strategy_name: Optional[str] = None
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


@router.get("/")
async def list_signals(
    limit: int = Query(default=50, le=200),
    symbol: Optional[str] = Query(default=None),
):
    """Get the latest signals, optionally filtered by symbol."""
    signals = await get_signals(limit=limit, symbol=symbol)
    return {"signals": signals, "count": len(signals)}


@router.post("/")
async def create_signal(
    payload: SignalCreate,
    _: bool = Depends(_check_api_key),
):
    """Manually insert a signal (used by bridge or testing)."""
    saved = await insert_signal(payload.model_dump())
    return {"status": "created", "signal": saved}


@router.patch("/{signal_id}/status")
async def patch_signal_status(
    signal_id: str,
    status: str = Query(..., pattern="^(pending|executed|failed|cancelled)$"),
    _: bool = Depends(_check_api_key),
):
    """Update a signal's execution status."""
    await update_signal_status(signal_id, status)
    return {"status": "updated", "signal_id": signal_id, "new_status": status}
