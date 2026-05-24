import Link from "next/link";
import { BarChart3, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const principles = [
  {
    icon: Shield,
    title: "Strict rule-based core",
    body: "No random signals. Entries, stops, targets, and bias checks come from reproducible engine logic.",
  },
  {
    icon: BarChart3,
    title: "Backtesting-first workflow",
    body: "Every market idea can be tested on historical candles, saved, and compared by risk metrics.",
  },
  {
    icon: Zap,
    title: "Live execution context",
    body: "TradingView charts, signal streams, and dashboard history sit beside the same asset universe.",
  },
];

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <section className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-end">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-200">About OGFX</div>
          <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-tight text-white sm:text-6xl">
            A trading cockpit built around measurable decisions.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-400">
            OGFX turns Smart Money Concepts into an auditable workflow: read live structure, run deterministic
            backtests, review saved outcomes, and keep every setup connected to the same market data model.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
              <Link href="/dashboard/charts">Open live charts</Link>
            </Button>
            <Button asChild variant="glass" className="rounded-xl">
              <Link href="/dashboard/backtest">Backtest dashboard</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),rgba(255,255,255,0.04)_46%,rgba(255,255,255,0.025))] p-5 shadow-[0_30px_110px_rgba(0,0,0,0.3)]">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {["Deterministic", "Multi-asset", "Audit-ready"].map((item, index) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="font-mono text-3xl font-black text-white">0{index + 1}</div>
                <div className="mt-3 text-sm font-semibold text-cyan-100">{item}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {principles.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                <Icon className="h-5 w-5 text-cyan-200" />
              </div>
              <h2 className="mt-6 text-lg font-bold text-white">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">{item.body}</p>
            </article>
          );
        })}
      </section>
    </main>
  );
}
