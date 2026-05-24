import Link from "next/link";
import { ArrowRight, BarChart3, BrainCircuit, CheckCircle2, LockKeyhole, Play, Radar, Sparkles, Waves } from "lucide-react";
import { LiquidMarketScene } from "@/components/marketing/LiquidMarketScene";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteNav } from "@/components/marketing/SiteNav";
import { Button } from "@/components/ui/button";

const stats = [
  ["12k+", "candles processed per run"],
  ["5", "protected workspaces"],
  ["24/7", "signal monitoring"],
  ["0.42s", "average decision cycle"],
];

const workflow = [
  {
    icon: BrainCircuit,
    title: "Deterministic SMC engine",
    body: "Liquidity sweeps, displacement, fair-value reactions, and bias filters stay auditable from signal to result.",
  },
  {
    icon: BarChart3,
    title: "Backtesting with memory",
    body: "Each run writes to Supabase so traders can compare pairs, sessions, drawdown, win rate, and trade logs.",
  },
  {
    icon: LockKeyhole,
    title: "Auth-first workspace",
    body: "Supabase SSR sessions protect dashboards and API routes before any private market history is returned.",
  },
];

const principles = ["Fluid motion", "3D depth", "Fast scanning", "Mobile-first", "Accessible contrast", "Low-friction actions"];

export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#070a12] text-white">
      <SiteNav />
      <main>
        <section className="hero-lab">
          <div className="hero-backdrop" aria-hidden="true" />
          <div className="hero-grid max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="hero-copy">
              <div className="hero-kicker">
                <Sparkles className="h-4 w-4" />
                Liquid market intelligence for OGFX
              </div>
              <h1>OGFX</h1>
              <p className="hero-lede">
                A premium SMC trading cockpit with animated market depth, Supabase-backed auth, saved backtests,
                and a modern interface built for fast trading decisions.
              </p>
              <div className="hero-actions">
                <Button asChild size="lg" className="liquid-button">
                  <Link href="/auth/signup">
                    Launch workspace <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="glass" className="glass-button">
                  <Link href="/dashboard/backtest">
                    <Play className="mr-2 h-4 w-4" />
                    Run backtest
                  </Link>
                </Button>
              </div>
              <div className="hero-trust">
                <span>
                  <CheckCircle2 className="h-4 w-4" />
                  Supabase Auth
                </span>
                <span>
                  <Radar className="h-4 w-4" />
                  Live signal flow
                </span>
                <span>
                  <Waves className="h-4 w-4" />
                  Motion-safe UI
                </span>
              </div>
            </div>

            <LiquidMarketScene />
          </div>
        </section>

        <section className="stat-ribbon" aria-label="OGFX platform stats">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="stat-ribbon-grid">
              {stats.map(([value, label]) => (
                <div key={label} className="stat-tile">
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="experience-section">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="section-intro">
              <span className="section-eyebrow">Modern trading UX</span>
              <h2>Designed like a command center, not a template.</h2>
              <p>
                The interface emphasizes depth, legibility, motion hierarchy, and the actions traders repeat every day.
              </p>
            </div>

            <div className="workflow-grid">
              {workflow.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="workflow-card">
                    <div className="workflow-icon">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="principles-band">
          <div className="principles-track">
            {[...principles, ...principles].map((item, index) => (
              <span key={`${item}-${index}`}>{item}</span>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
