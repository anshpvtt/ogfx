# OGFX Market Telegram MCP

This local Codex plugin adds an MCP server that can:

- analyze one symbol with the OGFX engine
- scan a watchlist for actionable setups
- send formatted Telegram alerts
- report whether your data-provider and Telegram settings are ready

## Setup

1. Copy `plugins/ogfx-market-telegram/.env.example` to `plugins/ogfx-market-telegram/.env`.
2. Fill in:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `TWELVEDATA_API_KEY` if you want real `XAUUSD` or forex analysis
3. Open this workspace in Codex and install the `OGFX Market Signals` plugin from the local marketplace.

## Notes

- `BTCUSD` and `ETHUSD` use Binance public candles.
- `XAUUSD`, `EURUSD`, `GBPUSD`, and `USDJPY` require `TWELVEDATA_API_KEY`.
- If real market data is unavailable, the MCP refuses to send a signal instead of using mock pricing.
- Signals are for research and automation workflows only, not guaranteed trading advice.
