"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TradingViewChartProps {
  symbol: string;
  interval?: string;
  theme?: "dark" | "light";
  autosize?: boolean;
  height?: number;
  width?: number;
  className?: string;
}

declare global {
  interface Window {
    TradingView: {
      widget: new (config: {
        container_id: string;
        symbol: string;
        interval: string;
        timezone: string;
        theme: string;
        style: string;
        locale: string;
        toolbar_bg: string;
        enable_publishing: boolean;
        hide_top_toolbar: boolean;
        allow_symbol_change: boolean;
        save_image: boolean;
        hideideas: boolean;
        studies: string[];
        show_popup_button: boolean;
        popup_width: string;
        popup_height: string;
        autosize: boolean;
        height?: number;
        width?: number;
        backgroundColor?: string;
        gridColor?: string;
        textColor?: string;
      }) => void;
    };
  }
}

export function TradingViewChart({
  symbol,
  interval = "15",
  theme = "dark",
  autosize = true,
  height = 600,
  width = 800,
  className,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => {
      if (window.TradingView && containerRef.current) {
        try {
          new window.TradingView.widget({
            container_id: containerRef.current.id,
            symbol: symbol,
            interval: interval,
            timezone: "Etc/UTC",
            theme: theme,
            style: "1",
            locale: "en",
            toolbar_bg: "#f1f3f6",
            enable_publishing: false,
            hide_top_toolbar: false,
            allow_symbol_change: true,
            save_image: true,
            hideideas: true,
            studies: ["RSI@tv-basicstudies", "EMA@tv-basicstudies"],
            show_popup_button: true,
            popup_width: "1000",
            popup_height: "650",
            autosize: autosize,
            height: autosize ? undefined : height,
            width: autosize ? undefined : width,
            backgroundColor: theme === "dark" ? "#0B0F19" : "#ffffff",
          });
          setIsLoaded(true);
        } catch (err) {
          setError("Failed to initialize TradingView chart");
          console.error(err);
        }
      }
    };
    script.onerror = () => {
      setError("Failed to load TradingView script");
    };

    document.head.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [symbol, interval, theme, autosize, height, width]);

  // Re-initialize when symbol changes
  useEffect(() => {
    if (window.TradingView && containerRef.current && isLoaded) {
      containerRef.current.innerHTML = "";
      try {
        new window.TradingView.widget({
          container_id: containerRef.current.id,
          symbol: symbol,
          interval: interval,
          timezone: "Etc/UTC",
          theme: theme,
          style: "1",
          locale: "en",
          toolbar_bg: "#f1f3f6",
          enable_publishing: false,
          hide_top_toolbar: false,
          allow_symbol_change: true,
          save_image: true,
          hideideas: true,
          studies: ["RSI@tv-basicstudies", "EMA@tv-basicstudies"],
          show_popup_button: true,
          popup_width: "1000",
          popup_height: "650",
          autosize: autosize,
          height: autosize ? undefined : height,
          width: autosize ? undefined : width,
          backgroundColor: theme === "dark" ? "#0B0F19" : "#ffffff",
        });
      } catch (err) {
        console.error("Failed to update chart:", err);
      }
    }
  }, [symbol, interval, theme, autosize, height, width, isLoaded]);

  if (error) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-ogfx-dark border border-ogfx-border rounded-lg",
          className
        )}
        style={{ height: autosize ? "100%" : height, width: autosize ? "100%" : width }}
      >
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div
      id={`tradingview-chart-${symbol.replace(/[^a-zA-Z0-9]/g, "-")}`}
      ref={containerRef}
      className={cn("rounded-lg overflow-hidden", className)}
      style={{ height: autosize ? "100%" : height, width: autosize ? "100%" : width }}
    />
  );
}
