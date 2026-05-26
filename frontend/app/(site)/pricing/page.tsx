import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const includedFeatures = [
  "All dashboard workspaces",
  "AI analysis and coaching",
  "Unlimited generated signals",
  "Backtest lab access",
  "Demo trading automation",
  "All supported assets",
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-sm text-cyan-100">
          <Sparkles className="h-4 w-4" />
          Billing paused
        </div>
        <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-6xl">
          OGFX is open access for now
        </h1>
        <p className="mt-4 text-slate-400">
          Subscription plans are temporarily disabled. Every user can access the full trading workspace while billing is paused.
        </p>
      </div>

      <Card className="mx-auto mt-10 max-w-2xl rounded-3xl border border-cyan-300/30 bg-[#0b1420]/84 shadow-[0_0_60px_rgba(34,211,238,0.12)]">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-white">
            <span>Full Access</span>
            <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-sm text-emerald-100">$0 while paused</span>
          </CardTitle>
          <div className="mt-2 text-sm text-slate-400">No checkout is required.</div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {includedFeatures.map((feature) => (
              <div key={feature} className="flex items-start gap-2 text-sm text-slate-300">
                <Check className="mt-0.5 h-4 w-4 text-emerald-400" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
          <Button asChild className="w-full rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
            <Link href="/dashboard">Open dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
