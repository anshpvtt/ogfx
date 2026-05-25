"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/smc-engine";

export function LiveSmcChart({
  candles = [],
  height = 160,
  onSnapshot,
}: {
  candles?: Candle[];
  height?: number;
  onSnapshot?: (dataUrl: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#05080c" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.08)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      timeScale: {
        borderColor: "rgba(148,163,184,0.16)",
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: "rgba(148,163,184,0.16)",
      },
      crosshair: {
        mode: 0,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#00d4aa",
      downColor: "#ff4d6d",
      borderVisible: false,
      wickUpColor: "#00d4aa",
      wickDownColor: "#ff4d6d",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || !candles.length) return;
    const data = candles
      .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
      .map((candle) => ({
        time: Math.floor(new Date(candle.time).getTime() / 1000) as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

    seriesRef.current.setData(data);
    chartRef.current.timeScale().fitContent();
    window.setTimeout(() => {
      try {
        const canvas = chartRef.current?.takeScreenshot();
        if (canvas && onSnapshot) onSnapshot(canvas.toDataURL("image/png"));
      } catch {
        // Screenshot capture is best-effort; TradingView iframe remains the main visual chart.
      }
    }, 250);
  }, [candles, onSnapshot]);

  return <div ref={containerRef} className="h-full min-h-[140px] w-full" />;
}
