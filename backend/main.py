"""OGFX FastAPI Backend — main entry point."""

import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from config import get_settings
from routers import signals, trades, analyze
from algo.signal_generator import run_all_symbols

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


async def _scheduled_signal_run():
    try:
        results = await run_all_symbols()
        actionable = [r for r in results if r.get("signal") in ("BUY", "SELL")]
        logger.info(f"Cycle complete — {len(results)} analyzed, {len(actionable)} actionable signals")
    except Exception as e:
        logger.error(f"Scheduled cycle error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 OGFX backend starting...")
    scheduler.add_job(
        _scheduled_signal_run,
        trigger=IntervalTrigger(seconds=settings.signal_interval_seconds),
        id="signal_loop",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info(f"⚡ Signal loop started (every {settings.signal_interval_seconds}s)")

    # Run first cycle immediately on startup
    asyncio.create_task(_scheduled_signal_run())

    yield

    scheduler.shutdown(wait=False)
    logger.info("OGFX backend stopped.")


app = FastAPI(
    title="OGFX API",
    description="AI-powered algorithmic trading signal system",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production to your Vercel domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(signals.router)
app.include_router(trades.router)
app.include_router(analyze.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "scheduler_running": scheduler.running,
        "instruments": settings.instruments,
        "signal_interval": settings.signal_interval_seconds,
    }


@app.get("/")
async def root():
    return {
        "name": "OGFX Trading API",
        "docs": "/docs",
        "health": "/health",
    }
