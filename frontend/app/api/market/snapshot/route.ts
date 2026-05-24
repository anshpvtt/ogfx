import { NextResponse, type NextRequest } from "next/server";
import { BACKTEST_TIMEFRAMES, TRADING_ASSETS, getTradingAsset } from "@/lib/assets";
import { fetchYahooCandles } from "@/lib/market-data";
import type { Candle } from "@/lib/smc-engine";

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function ema(values: number[], period: number) {
  if (!values.length) return 0;
  const multiplier = 2 / (period + 1);
  return values.reduce((previous, value, index) => {
    if (index === 0) return value;
    return value * multiplier + previous * (1 - multiplier);
  }, values[0]);
}

function atr(candles: Candle[], period = 14) {
  const sample = candles.slice(-period - 1);
  if (sample.length < 2) return 0;
  const ranges = sample.slice(1).map((candle, index) => {
    const previousClose = sample[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  return average(ranges);
}

function toSnapshot(assetId: string, timeframe: string, candles: Candle[]) {
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes.slice(-60), 20);
  const ema50 = ema(closes.slice(-100), 50);
  const trend = ema20 > ema50 ? "BULLISH" : ema20 < ema50 ? "BEARISH" : "NEUTRAL";
  const dayChange = latest && previous ? latest.close - previous.close : 0;
  const dayChangePct = latest && previous && previous.close ? (dayChange / previous.close) * 100 : 0;

  return {
    assetId,
    timeframe,
    latest: latest
      ? {
          time: latest.time,
          open: latest.open,
          high: latest.high,
          low: latest.low,
          close: latest.close,
          volume: latest.volume ?? 0,
        }
      : null,
    dayChange,
    dayChangePct,
    trend,
    ema20,
    ema50,
    atr: atr(candles),
    candles: candles.slice(-80),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pairParam = searchParams.get("pair")?.toUpperCase();
  const timeframeParam = searchParams.get("timeframe")?.toUpperCase() || "1H";
  const timeframe = BACKTEST_TIMEFRAMES.some((item) => item.value === timeframeParam) ? timeframeParam : "1H";
  const assets = pairParam
    ? [getTradingAsset(pairParam)].filter(Boolean)
    : TRADING_ASSETS;

  if (!assets.length) {
    return NextResponse.json({ error: "Unknown asset" }, { status: 400 });
  }

  const results = await Promise.allSettled(
    assets.map(async (asset) => {
      const candles = await fetchYahooCandles({
        pair: asset!.id,
        timeframe,
        range: timeframe === "1D" ? "1y" : "60d",
      });
      return toSnapshot(asset!.id, timeframe, candles);
    })
  );

  const snapshots = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const errors = results.flatMap((result, index) =>
    result.status === "rejected" ? [{ assetId: assets[index]?.id, error: result.reason?.message || "Snapshot failed" }] : []
  );

  return NextResponse.json({
    provider: "Yahoo Finance",
    delayed: true,
    snapshots,
    errors,
    timestamp: new Date().toISOString(),
  });
}
