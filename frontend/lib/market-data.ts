import type { Candle } from "@/lib/smc-engine";
import { getTradingAsset } from "@/lib/assets";

const INTERVALS: Record<string, string> = {
  "1H": "1h",
  "4H": "1h",
  "1D": "1d",
  "1h": "1h",
  "4h": "1h",
  "1d": "1d",
};

function toUnixSeconds(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : undefined;
}

function aggregateCandles(candles: Candle[], size: number): Candle[] {
  if (size <= 1) return candles;
  const aggregated: Candle[] = [];
  for (let i = 0; i < candles.length; i += size) {
    const chunk = candles.slice(i, i + size);
    if (chunk.length < size) continue;
    aggregated.push({
      time: chunk[chunk.length - 1].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((candle) => candle.high)),
      low: Math.min(...chunk.map((candle) => candle.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, candle) => sum + (candle.volume ?? 0), 0),
    });
  }
  return aggregated;
}

export async function fetchYahooCandles({
  pair,
  timeframe,
  range = "2y",
  startDate,
  endDate,
}: {
  pair: string;
  timeframe: string;
  range?: string;
  startDate?: string;
  endDate?: string;
}): Promise<Candle[]> {
  const symbol = getTradingAsset(pair)?.yahooSymbol ?? pair;
  const normalizedTimeframe = timeframe.toUpperCase();
  const interval = INTERVALS[normalizedTimeframe] ?? "1h";
  const params = new URLSearchParams({ interval });
  const period1 = startDate ? toUnixSeconds(startDate) : undefined;
  const period2 = endDate ? toUnixSeconds(endDate) : undefined;

  if (period1 && period2) {
    params.set("period1", String(period1));
    params.set("period2", String(period2));
  } else {
    params.set("range", range);
  }

  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps: number[] = result?.timestamp ?? [];

  if (!quote || !timestamps.length) return [];

  const candles = timestamps
    .map((timestamp, index) => ({
      time: new Date(timestamp * 1000).toISOString(),
      open: Number(quote.open?.[index]),
      high: Number(quote.high?.[index]),
      low: Number(quote.low?.[index]),
      close: Number(quote.close?.[index]),
      volume: Number(quote.volume?.[index] ?? 0),
    }))
    .filter((candle) =>
      [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0)
    );

  return normalizedTimeframe === "4H" ? aggregateCandles(candles, 4) : candles;
}
