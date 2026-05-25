"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, FileText, Shield } from "lucide-react";
import { TRADING_ASSETS } from "@/lib/assets";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const EXPERIENCE = ["beginner", "intermediate", "advanced"];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [step, setStep] = useState(1);
  const [experience, setExperience] = useState("intermediate");
  const [riskPercent, setRiskPercent] = useState(1);
  const [balance, setBalance] = useState(10000);
  const [pairs, setPairs] = useState<string[]>(["XAUUSD", "EURUSD"]);
  const [file, setFile] = useState<File | null>(null);
  const [strategyName, setStrategyName] = useState("My OGFX Playbook");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function togglePair(pair: string) {
    setPairs((current) =>
      current.includes(pair)
        ? current.filter((item) => item !== pair)
        : [...current, pair].slice(0, 7)
    );
  }

  async function finish() {
    setError("");
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/auth/login");
        return;
      }

      const now = new Date().toISOString();
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email,
        full_name: user.user_metadata?.full_name || user.email,
        name: user.user_metadata?.full_name || user.email,
        trading_experience: experience,
        risk_percent: riskPercent,
        preferred_pairs: pairs.length ? pairs : ["XAUUSD"],
        demo_balance: balance,
        demo_equity: balance,
        onboarding_completed: true,
        updated_at: now,
      });
      if (profileError) throw new Error(profileError.message);

      const { data: existingAccount } = await supabase
        .from("demo_accounts")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      const accountPayload = {
        user_id: user.id,
        initial_balance: balance,
        balance,
        equity: balance,
        free_margin: balance,
        margin: 0,
        updated_at: now,
      };
      if (existingAccount?.id) {
        await supabase.from("demo_accounts").update(accountPayload).eq("id", existingAccount.id);
      } else {
        await supabase.from("demo_accounts").insert(accountPayload);
      }

      await supabase.from("demo_account_settings").upsert({
        user_id: user.id,
        balance,
        equity: balance,
        free_margin: balance,
        margin: 0,
        risk_per_trade: riskPercent / 100,
        watched_assets: pairs.length ? pairs : ["XAUUSD"],
        updated_at: now,
      }, { onConflict: "user_id" });

      if (file) {
        const form = new FormData();
        form.append("file", file);
        form.append("name", strategyName || file.name);
        const response = await fetch("/api/ai/parse-strategy", { method: "POST", body: form });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Strategy upload failed");
        }
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Onboarding failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#060b12] px-4 py-10 text-white">
      <div className="mx-auto max-w-4xl rounded-3xl border border-amber-200/15 bg-white/[0.035] p-6 shadow-2xl shadow-black/30 backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-300 text-black">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.34em] text-amber-200">OGFX Setup</p>
            <h1 className="text-2xl font-black">Build your demo trading workspace</h1>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {["Experience", "Strategy", "Risk"].map((label, index) => (
            <div key={label} className={`rounded-2xl border p-4 ${step === index + 1 ? "border-cyan-300/40 bg-cyan-300/10" : "border-white/10 bg-black/20"}`}>
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Step {index + 1}</div>
              <div className="mt-1 font-semibold">{label}</div>
            </div>
          ))}
        </div>

        <section className="mt-8 min-h-[360px]">
          {step === 1 && (
            <div>
              <h2 className="text-xl font-bold">What is your trading experience?</h2>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {EXPERIENCE.map((item) => (
                  <button
                    key={item}
                    onClick={() => setExperience(item)}
                    className={`rounded-2xl border p-5 text-left capitalize transition ${experience === item ? "border-amber-300/50 bg-amber-300/10" : "border-white/10 bg-white/[0.03] hover:border-white/20"}`}
                  >
                    <span className="font-semibold">{item}</span>
                    <span className="mt-2 block text-sm text-slate-400">Tune OGFX coach tone and risk defaults.</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-xl font-bold">Upload your strategy PDF</h2>
              <p className="mt-2 text-sm text-slate-400">Optional. Gemma will compare setups against this playbook when your plan allows strategy analysis.</p>
              <div className="mt-5 rounded-2xl border border-dashed border-white/20 bg-black/20 p-6">
                <FileText className="h-8 w-8 text-cyan-200" />
                <input
                  className="mt-5 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm"
                  value={strategyName}
                  onChange={(event) => setStrategyName(event.target.value)}
                  placeholder="Strategy name"
                />
                <input
                  type="file"
                  accept="application/pdf"
                  className="mt-4 block w-full text-sm text-slate-300 file:mr-4 file:rounded-xl file:border-0 file:bg-amber-300 file:px-4 file:py-2 file:font-semibold file:text-black"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                {file && <div className="mt-3 text-sm text-emerald-200">{file.name}</div>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold">Set risk and pairs</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <span className="text-sm text-slate-400">Risk per trade (%)</span>
                  <input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={riskPercent}
                    onChange={(event) => setRiskPercent(Number(event.target.value))}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono"
                  />
                </label>
                <label className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <span className="text-sm text-slate-400">Starting demo balance</span>
                  <input
                    type="number"
                    min="100"
                    max="100000000"
                    value={balance}
                    onChange={(event) => setBalance(Number(event.target.value))}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono"
                  />
                </label>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {TRADING_ASSETS.slice(0, 7).map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => togglePair(asset.id)}
                    className={`rounded-full border px-4 py-2 text-sm ${pairs.includes(asset.id) ? "border-cyan-300/50 bg-cyan-300/10 text-white" : "border-white/10 text-slate-400"}`}
                  >
                    {asset.id}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {error && <div className="rounded-2xl border border-red-300/20 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>}

        <div className="mt-8 flex justify-between">
          <button
            onClick={() => setStep((value) => Math.max(1, value - 1))}
            className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-300 disabled:opacity-40"
            disabled={step === 1 || loading}
          >
            Back
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((value) => value + 1)}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-black text-black"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={finish}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-black disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> {loading ? "Saving..." : "Launch dashboard"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
