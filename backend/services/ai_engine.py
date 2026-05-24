"""AI engine — uses Google Gemini to score strategies and generate trading signals."""

import json
import logging
from typing import Optional
import google.generativeai as genai
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_model = None

SYSTEM_INSTRUCTION = """You are an expert quantitative trading analyst with 15+ years of experience
in Forex, Gold, and Crypto markets. Your role is to evaluate market conditions against trading strategies
and generate precise, high-probability trading signals.

You must always respond in valid JSON format only — no prose, no markdown, no code fences.
Your analysis must be objective, data-driven, and conservative. Only recommend BUY or SELL when
you have genuine conviction. When in doubt, respond with SKIP.

Always prioritize capital preservation over chasing signals."""


def _get_model():
    global _model
    if _model is None:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY not set in .env")
        genai.configure(api_key=settings.gemini_api_key)
        _model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            system_instruction=SYSTEM_INSTRUCTION,
            generation_config=genai.types.GenerationConfig(
                temperature=0.3,
                top_p=0.9,
                max_output_tokens=1024,
                response_mime_type="application/json",
            ),
        )
    return _model


def _build_prompt(symbol: str, snapshot: dict, strategies: list[dict]) -> str:
    strategy_summaries = []
    for s in strategies:
        strategy_summaries.append({
            "id": s["id"],
            "name": s["name"],
            "description": s["description"],
            "entry_conditions": s["entry_conditions"],
            "risk_reward": s["risk_reward"],
            "historical_win_rate": s.get("win_rate_historical", 0),
        })

    return f"""Analyze the following real-time market data and evaluate which trading strategy applies best.

## Symbol: {symbol}

## Current Market Snapshot:
```json
{json.dumps(snapshot, indent=2)}
```

## Available Strategies:
```json
{json.dumps(strategy_summaries, indent=2)}
```

## Your Task:
1. Evaluate each strategy against the current market conditions
2. Identify the BEST matching strategy (if any)
3. Consider multi-timeframe context from the indicators
4. Generate a trading signal

## Response Format (JSON only):
{{
  "signal": "BUY" | "SELL" | "SKIP",
  "confidence": <integer 0-100>,
  "strategy_id": "<matched strategy id or null>",
  "strategy_name": "<matched strategy name or null>",
  "reason": "<concise 1-2 sentence explanation of why this signal was generated>",
  "entry_price": <current close price or null>,
  "stop_loss": <price level or null>,
  "take_profit": <price level or null>,
  "risk_reward": <ratio as float or null>,
  "key_factors": ["<factor 1>", "<factor 2>", "<factor 3>"],
  "market_bias": "bullish" | "bearish" | "neutral",
  "session_favorable": true | false
}}

Rules:
- Only output BUY or SELL if confidence >= 70
- Output SKIP if market conditions are unclear or no strategy matches well
- stop_loss and take_profit must respect the strategy's minimum RR ratio
- Be honest about low-confidence situations
"""


async def analyze_with_ai(symbol: str, snapshot: dict, strategies: list[dict]) -> dict:
    """Run Gemini analysis and return a structured signal decision."""
    try:
        model = _get_model()
        prompt = _build_prompt(symbol, snapshot, strategies)

        response = model.generate_content(prompt)
        raw = response.text.strip()

        # Strip markdown fences if somehow present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        result = json.loads(raw)

        # Enforce confidence threshold
        if result.get("confidence", 0) < settings.min_confidence_threshold:
            result["signal"] = "SKIP"
            result["reason"] = f"(Confidence {result['confidence']}% below threshold {settings.min_confidence_threshold}%) " + result.get("reason", "")

        result["symbol"] = symbol
        return result

    except json.JSONDecodeError as e:
        logger.error(f"AI response JSON parse error for {symbol}: {e}")
        return _fallback_skip(symbol, "AI returned invalid JSON")
    except Exception as e:
        logger.error(f"AI analysis failed for {symbol}: {e}")
        return _fallback_skip(symbol, str(e))


def _fallback_skip(symbol: str, reason: str) -> dict:
    return {
        "symbol": symbol,
        "signal": "SKIP",
        "confidence": 0,
        "strategy_id": None,
        "strategy_name": None,
        "reason": f"AI analysis error: {reason}",
        "entry_price": None,
        "stop_loss": None,
        "take_profit": None,
        "risk_reward": None,
        "key_factors": [],
        "market_bias": "neutral",
        "session_favorable": False,
    }
