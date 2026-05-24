from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Gemini ──────────────────────────────────────────────
    gemini_api_key: str = ""

    # ── Supabase ────────────────────────────────────────────
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # ── Telegram ────────────────────────────────────────────
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # ── Auth ────────────────────────────────────────────────
    jwt_secret: str = "change_me_in_production_at_least_32_chars"
    api_key: str = "internal_api_key_for_bridge"

    # ── App Config ──────────────────────────────────────────
    environment: str = "development"
    signal_interval_seconds: int = 15
    min_confidence_threshold: int = 70
    max_signals_per_hour: int = 12
    log_level: str = "INFO"

    # ── Instruments ─────────────────────────────────────────
    instruments: list[str] = ["EURUSD", "GBPUSD", "XAUUSD", "BTCUSDT"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
