import Link from "next/link";
import { ArrowRight, BarChart3, CandlestickChart, History, LineChart, RadioTower, Signal, Sparkles } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TRADING_ASSETS } from "@/lib/assets";

const primaryActions = [
  {
    href: "/dashboard/charts",
    title: "Live chart room",
    body: "TradingView charts for every supported OGFX market.",
    icon: LineChart,
    accent: "text-cyan-200",
  },
  {
    href: "/dashboard/backtest",
    title: "Backtest lab",
    body: "Run the SMC engine across forex, metals, crypto, energy, and indices.",
    icon: BarChart3,
    accent: "text-amber-200",
  },
  {
    href: "/dashboard/analyze",
    title: "Analysis studio",
    body: "Blend TradingView context with LSBR playbook scoring.",
    icon: CandlestickChart,
    accent: "text-emerald-200",
  },
];

const operations = [
  ["Asset universe", `${TRADING_ASSETS.length} live markets`, "TradingView + Yahoo historical data"],
  ["Signal feed", "Realtime inserts", "Supabase protected stream"],
  ["Backtest memory", "Saved runs", "Equity curves and trade logs"],
];

export default function DashboardPage() {
  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Protected workspace"
        title="OGFX command center"
        description="A faster dashboard for reading live markets, running SMC backtests, reviewing signal flow, and returning to saved research without losing context."
        actions={
          <>
            <Button asChild variant="glass" className="rounded-xl">
              <Link href="/dashboard/signals">Review signals</Link>
            </Button>
            <Button asChild className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
              <Link href="/dashboard/charts">
                Open charts <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden rounded-3xl border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),rgba(255,255,255,0.045)_40%,rgba(255,255,255,0.026))] shadow-[0_30px_100px_rgba(0,0,0,0.32)]">
          <CardContent className="p-6 sm:p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  Live workflow
                </div>
                <h2 className="mt-5 max-w-2xl text-3xl font-black leading-tight text-white sm:text-5xl">
                  Chart, test, and audit the same market idea.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
                  The workspace now keeps charts, backtests, LSBR analysis, live signals, and saved history inside one consistent navigation model.
                </p>
              </div>
              <div className="hidden rounded-3xl border border-white/10 bg-black/20 p-4 sm:block">
                <RadioTower className="h-6 w-6 text-emerald-300" />
                <div className="mt-6 font-mono text-3xl font-black text-white">24/7</div>
                <div className="text-xs text-slate-500">market monitoring</div>
              </div>
            </div>

            <div className="mt-8 grid gap-3 md:grid-cols-3">
              {operations.map(([label, value, detail]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
                  <div className="mt-2 text-xl font-bold text-white">{value}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{detail}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {primaryActions.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-3xl border border-white/10 bg-white/[0.04] p-5 transition-all hover:border-cyan-300/25 hover:bg-white/[0.065]"
              >
                <div className="flex items-start gap-4">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-black/20">
                    <Icon className={`h-5 w-5 ${item.accent}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-bold text-white">{item.title}</h3>
                      <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-1 group-hover:text-cyan-200" />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{item.body}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {[
          { icon: Signal, label: "Signals", value: "Realtime", href: "/dashboard/signals" },
          { icon: History, label: "History", value: "Saved runs", href: "/dashboard/history" },
          { icon: BarChart3, label: "Backtests", value: "All assets", href: "/dashboard/backtest" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="rounded-3xl border border-white/10 bg-[#0b1420]/84 p-5 transition-colors hover:border-white/20">
              <Icon className="h-5 w-5 text-cyan-200" />
              <div className="mt-5 text-xs uppercase tracking-[0.22em] text-slate-500">{item.label}</div>
              <div className="mt-2 text-2xl font-bold text-white">{item.value}</div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
