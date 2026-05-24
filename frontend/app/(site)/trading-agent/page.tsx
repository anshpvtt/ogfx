import Link from "next/link";
import { ArrowRight, BarChart3, Bot, Layers, Shield, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

const checks = [
  { icon: Layers, title: "HTF bias", body: "Directional structure and swing context before execution." },
  { icon: Shield, title: "Liquidity pools", body: "Equal highs, equal lows, and sweep targets." },
  { icon: Bot, title: "Sweep + displacement", body: "Stop runs followed by impulse validation." },
  { icon: BarChart3, title: "Confirmation", body: "BOS, MSS, engulfing, and risk-reward filters." },
];

export default function TradingAgentPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <section className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-sm font-semibold text-cyan-100">
            <Bot className="h-4 w-4" />
            ELITE SMC engine
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl font-black leading-tight tracking-tight text-white sm:text-6xl">
            A decision engine you can chart, backtest, audit, and deploy.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-400">
            OGFX keeps the trading loop strict and measurable: mark live structure, run historical tests,
            save outcomes, and review the exact logic behind every setup.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
              <Link href="/dashboard/backtest">
                Run backtest <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="glass" className="rounded-xl">
              <Link href="/dashboard/charts">Open live charts</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.15),rgba(255,255,255,0.04)_48%,rgba(255,255,255,0.025))] p-5">
          <div className="flex items-center gap-3 border-b border-white/10 pb-5">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-black/20">
              <SlidersHorizontal className="h-5 w-5 text-cyan-200" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">What the agent checks</h2>
              <p className="text-sm text-slate-400">A compact model for repeatable SMC execution.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {checks.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <Icon className="h-4 w-4 text-cyan-200" />
                    {item.title}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{item.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
