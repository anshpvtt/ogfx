"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function CapitalGrowthChart({
  snapshots,
  startingCapital,
}: {
  snapshots: Array<{ time: number; capital: number }>;
  startingCapital: number;
}) {
  const data = snapshots.length > 1
    ? snapshots
    : Array.from({ length: 24 }, (_, index) => ({
        time: Date.now() + index * 3600000,
        capital: startingCapital * Math.pow(1.003, index * 20),
      }));

  const target = 100000;
  const tradesNeeded = Math.log(target / Math.max(1, startingCapital)) / Math.log(1.003);
  const hours = tradesNeeded / 20;

  return (
    <section className="arb-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="arb-label">capital curve</div>
          <h3 className="font-mono text-lg font-black text-[#e0ffe8]">$1 → $100k SIM</h3>
        </div>
        <div className="font-mono text-xs text-[#ffaa00]">~{Math.max(1, hours / 24).toFixed(1)} days</div>
      </div>
      <div className="mt-4 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="arbCapital" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#00ff88" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#00ff88" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Tooltip
              contentStyle={{ background: "#020c07", border: "1px solid rgba(0,255,136,0.25)", color: "#e0ffe8", fontFamily: "monospace" }}
              formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "capital"]}
              labelFormatter={(value) => new Date(Number(value)).toLocaleTimeString()}
            />
            <Area type="monotone" dataKey="capital" stroke="#00ff88" strokeWidth={2} fill="url(#arbCapital)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 rounded border border-[#ffaa00]/25 bg-[#ffaa00]/10 p-3 font-mono text-[11px] leading-5 text-[#ffd27a]">
        Theoretical paper simulation. Real exchanges have fees, slippage, latency, API limits, partial fills, and market risk.
      </p>
    </section>
  );
}
