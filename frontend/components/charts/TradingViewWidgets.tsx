"use client";

import { useEffect, useMemo, useRef } from "react";

type TradingViewSymbol = {
  label: string;
  tv: string;
};

function useStableId(prefix: string) {
  const idRef = useRef<string | null>(null);
  if (!idRef.current) {
    idRef.current = `${prefix}-${Math.random().toString(36).slice(2)}`;
  }
  return idRef.current;
}

function loadTradingViewScript() {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }

  const existing = document.querySelector<HTMLScriptElement>('script[data-tv="tvjs"]');
  if (existing) {
    if ((window as any).TradingView) {
      return Promise.resolve((window as any).TradingView);
    }

    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve((window as any).TradingView), {
        once: true,
      });
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.dataset.tv = "tvjs";
    script.onload = () => resolve((window as any).TradingView);
    document.head.appendChild(script);
  });
}

export function TradingViewAdvancedChart({
  symbol,
  interval = "15",
  theme = "dark",
  height = 560,
  terminal = false,
}: {
  symbol: string;
  interval?: string;
  theme?: "dark" | "light";
  height?: number;
  terminal?: boolean;
}) {
  const containerId = useStableId("tv-advanced");
  const initializedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    initializedRef.current = false;
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";

    const init = async () => {
      const tradingView = await loadTradingViewScript();
      if (!tradingView || initializedRef.current) return;
      initializedRef.current = true;

      new tradingView.widget({
        autosize: true,
        symbol,
        interval,
        timezone: "Asia/Kolkata",
        theme,
        style: "1",
        locale: "en",
        allow_symbol_change: true,
        hide_side_toolbar: false,
        save_image: true,
        withdateranges: false,
        details: false,
        hotlist: false,
        calendar: false,
        hide_volume: true,
        studies: [],
        disabled_features: [
          "volume_force_overlay",
          "create_volume_indicator_by_default",
          "header_indicators",
        ],
        container_id: containerId,
      });
    };

    init();
  }, [containerId, symbol, interval, theme]);

  return (
    <div
      className={
        terminal
          ? "h-full w-full overflow-hidden bg-[#080d12]"
          : "w-full overflow-hidden rounded-[28px] border border-white/10 bg-black/20 shadow-[0_24px_80px_rgba(0,0,0,0.36)]"
      }
    >
      <div style={{ height }} className="w-full">
        <div id={containerId} className="h-full w-full" />
      </div>
    </div>
  );
}

export function TradingViewSymbolGrid({
  symbols,
  theme = "dark",
  onPick,
  activeTvSymbol,
}: {
  symbols: TradingViewSymbol[];
  theme?: "dark" | "light";
  onPick: (tvSymbol: string) => void;
  activeTvSymbol?: string;
}) {
  const containerId = useStableId("tv-grid");
  const config = useMemo(
    () => ({
      symbols: symbols.map((symbol) => [symbol.label, symbol.tv]),
      chartOnly: false,
      width: "100%",
      height: "100%",
      locale: "en",
      colorTheme: theme,
      autosize: true,
      showVolume: false,
      showMA: false,
      hideDateRanges: false,
      hideMarketStatus: false,
      hideSymbolLogo: false,
      scalePosition: "right",
      scaleMode: "Normal",
      fontFamily: "var(--font-inter), system-ui, sans-serif",
      fontSize: "11",
      noTimeScale: false,
      valuesTracking: "1",
      changeMode: "price-and-percent",
      chartType: "area",
      lineWidth: 2,
      lineType: 0,
      dateRanges: ["1D", "5D", "1M", "3M", "6M", "12M"],
    }),
    [symbols, theme]
  );

  useEffect(() => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify(config);
    el.appendChild(script);
  }, [containerId, config]);

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <div className="text-sm font-semibold text-white">Live market board</div>
          <div className="text-xs text-gray-400">Tap a symbol to reload the workspace chart.</div>
        </div>
        {activeTvSymbol ? (
          <button
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-white/20 hover:text-white"
            onClick={() => onPick(activeTvSymbol)}
            type="button"
          >
            Refresh
          </button>
        ) : null}
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {symbols.map((symbol) => {
            const active = symbol.tv === activeTvSymbol;
            return (
              <button
                key={symbol.tv}
                type="button"
                onClick={() => onPick(symbol.tv)}
                className={[
                  "rounded-2xl border px-3 py-3 text-left transition-all",
                  active
                    ? "border-cyan-400/40 bg-cyan-400/10 text-white shadow-[0_0_24px_rgba(34,211,238,0.12)]"
                    : "border-white/10 bg-black/20 text-gray-300 hover:border-white/20 hover:text-white",
                ].join(" ")}
              >
                <div className="text-sm font-medium">{symbol.label}</div>
                <div className="mt-1 text-[10px] opacity-70">{symbol.tv}</div>
              </button>
            );
          })}
        </div>

        <div className="h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <div id={containerId} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
