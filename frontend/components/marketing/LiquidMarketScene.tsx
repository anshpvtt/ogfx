import type { CSSProperties } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Gauge, Orbit, ShieldCheck, Zap } from "lucide-react";

const candles = [
  { h: 62, y: 24, body: 30, tone: "up" },
  { h: 88, y: 10, body: 44, tone: "up" },
  { h: 54, y: 34, body: 24, tone: "down" },
  { h: 102, y: 8, body: 54, tone: "up" },
  { h: 74, y: 22, body: 32, tone: "down" },
  { h: 116, y: 0, body: 62, tone: "up" },
  { h: 68, y: 26, body: 28, tone: "up" },
  { h: 94, y: 12, body: 46, tone: "down" },
  { h: 122, y: 0, body: 66, tone: "up" },
  { h: 80, y: 18, body: 34, tone: "up" },
  { h: 108, y: 6, body: 52, tone: "down" },
  { h: 138, y: 0, body: 74, tone: "up" },
];

const telemetry = [
  { label: "Live win rate", value: "72.4%", icon: Gauge },
  { label: "Drawdown guard", value: "8.1%", icon: ShieldCheck },
  { label: "Signal latency", value: "42ms", icon: Zap },
];

export function LiquidMarketScene() {
  return (
    <div className="liquid-scene" aria-label="Animated OGFX market intelligence preview">
      <div className="liquid-field" aria-hidden="true">
        <span className="liquid-band liquid-band-a" />
        <span className="liquid-band liquid-band-b" />
        <span className="liquid-band liquid-band-c" />
      </div>

      <div className="scene-shell">
        <div className="scene-toolbar">
          <div className="scene-brand">
            <span className="scene-mark">
              <Orbit className="h-4 w-4" />
            </span>
            <span>OGFX Quantum Desk</span>
          </div>
          <div className="scene-pulse">
            <span />
            Synced
          </div>
        </div>

        <div className="scene-depth">
          <div className="market-board">
            <div className="market-header">
              <div>
                <p className="micro-label">SMC liquidity map</p>
                <h2>EURUSD 1H</h2>
              </div>
              <div className="profit-pill">
                <ArrowUpRight className="h-4 w-4" />
                +18.6R
              </div>
            </div>

            <div className="chart-stage">
              <div className="chart-grid" />
              <div className="liquidity-zone liquidity-zone-top">sell-side sweep</div>
              <div className="liquidity-zone liquidity-zone-bottom">demand block</div>
              <div className="price-line" />
              <div className="candle-row" aria-hidden="true">
                {candles.map((candle, index) => (
                  <span
                    key={`${candle.tone}-${index}`}
                    className={`candle ${candle.tone}`}
                    style={
                      {
                        "--wick": `${candle.h}px`,
                        "--offset": `${candle.y}px`,
                        "--body": `${candle.body}px`,
                        "--delay": `${index * 80}ms`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
              <div className="trade-vector">
                <span className="vector-dot" />
                <span className="vector-line" />
                <span className="vector-target">TP 1.618</span>
              </div>
            </div>
          </div>

          <div className="side-stack">
            <div className="signal-panel floating-panel">
              <p className="micro-label">Current decision</p>
              <div className="signal-row">
                <span className="signal-badge">BUY</span>
                <span>High confidence</span>
              </div>
              <div className="signal-metrics">
                <span>Entry 1.0832</span>
                <span>SL 1.0794</span>
                <span>TP 1.0918</span>
              </div>
            </div>

            <div className="risk-panel floating-panel">
              <div className="risk-ring">
                <Activity className="h-5 w-5" />
                <span>96</span>
              </div>
              <div>
                <p className="micro-label">Model score</p>
                <strong>Structure aligned</strong>
                <small>No-trade filters passed</small>
              </div>
            </div>

            <div className="flow-panel floating-panel">
              <ArrowDownRight className="h-4 w-4 text-rose-300" />
              <span>News volatility dampened</span>
            </div>
          </div>
        </div>

        <div className="telemetry-strip">
          {telemetry.map((item) => {
            const Icon = item.icon;
            return (
              <div className="telemetry-item" key={item.label}>
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
