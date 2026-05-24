"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const tiers = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    hint: "Validate the workflow",
    features: ["5 backtests/month", "Core chart workspace", "Delayed signals"],
    cta: "Create account",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29/mo",
    hint: "For active discretionary traders",
    features: ["Unlimited backtests", "All dashboard assets", "Live signals", "Email alerts"],
    cta: "Upgrade to Pro",
    featured: true,
  },
  {
    id: "elite",
    name: "Elite",
    price: "$79/mo",
    hint: "Full engine access",
    features: ["All assets", "Priority signals", "API access", "Discord webhook"],
    cta: "Upgrade to Elite",
  },
];

export default function PricingPage() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function checkout(plan: string) {
    if (plan === "free") return;
    setLoadingPlan(plan);
    setError("");
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Checkout failed");
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-sm text-cyan-100">
          <Sparkles className="h-4 w-4" />
          Stripe subscriptions
        </div>
        <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-6xl">
          Pricing for measurable SMC execution
        </h1>
        <p className="mt-4 text-slate-400">Start with charting and backtests, then scale into live alerts and API access.</p>
      </div>

      {error ? <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {tiers.map((tier) => (
          <Card
            key={tier.id}
            className={[
              "rounded-3xl border bg-[#0b1420]/84 transition hover:border-cyan-300/35",
              tier.featured ? "border-cyan-300/40 shadow-[0_0_60px_rgba(34,211,238,0.12)]" : "border-white/10",
            ].join(" ")}
          >
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-white">
                <span>{tier.name}</span>
                {tier.featured ? <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-xs text-cyan-100">Popular</span> : null}
              </CardTitle>
              <div className="mt-2 text-3xl font-bold text-white">{tier.price}</div>
              <div className="mt-1 text-sm text-slate-400">{tier.hint}</div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {tier.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check className="mt-0.5 h-4 w-4 text-emerald-400" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
              {tier.id === "free" ? (
                <Button asChild variant="glass" className="w-full rounded-xl">
                  <Link href="/auth/signup">{tier.cta}</Link>
                </Button>
              ) : (
                <Button onClick={() => checkout(tier.id)} disabled={loadingPlan === tier.id} className="w-full rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
                  {loadingPlan === tier.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {tier.cta}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
