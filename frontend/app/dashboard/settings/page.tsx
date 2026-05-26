"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, KeyRound, Link2, Loader2, PlugZap, Save, Shield } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Tab = "profile" | "strategy" | "demo" | "exchange" | "access";

const EXCHANGE_NAMES = ["Binance", "Coinbase", "Kraken", "OKX", "Bybit"];

export default function DashboardSettingsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [tab, setTab] = useState<Tab>("profile");
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [strategyFile, setStrategyFile] = useState<File | null>(null);
  const [strategyName, setStrategyName] = useState("OGFX Playbook");
  const [strategyVideoUrl, setStrategyVideoUrl] = useState("");
  const [strategyNotes, setStrategyNotes] = useState("");
  const [startingBalance, setStartingBalance] = useState(10000);
  const [riskPerTrade, setRiskPerTrade] = useState(1);
  const [defaultSize, setDefaultSize] = useState(1);
  const [leverage, setLeverage] = useState(100);
  const [exchangeRows, setExchangeRows] = useState<any[]>([]);
  const [exchangeDrafts, setExchangeDrafts] = useState<Record<string, { apiKey: string; secret: string; isActive: boolean }>>({});
  const [liveModeRequested, setLiveModeRequested] = useState(false);

  async function load() {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return;
    setUserId(user.id);
    setEmail(user.email ?? "");
    setWebhookUrl((user.user_metadata?.discord_webhook_url as string) ?? "");

    const [{ data: profileRow }, { data: settingsRow }, { data: strategyRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("demo_account_settings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("user_strategies").select("id,name,description,is_active,created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    setProfile(profileRow);
    setSettings(settingsRow);
    setStrategies(strategyRows ?? []);
    setStartingBalance(Number(settingsRow?.balance ?? profileRow?.demo_balance ?? 10000));
    setRiskPerTrade(Number(profileRow?.risk_percent ?? (Number(settingsRow?.risk_per_trade ?? 0.01) * 100)));
    setDefaultSize(Number(settingsRow?.default_size ?? 1));
    setLeverage(Number(settingsRow?.leverage ?? 100));

    const exchangeResponse = await fetch("/api/arb/exchange/keys").catch(() => null);
    const exchangePayload = exchangeResponse ? await exchangeResponse.json().catch(() => null) : null;
    setExchangeRows(Array.isArray(exchangePayload?.exchanges) ? exchangePayload.exchanges : []);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "exchange") setTab("exchange");
  }, []);

  async function saveAccount() {
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({
      email,
      ...(password ? { password } : {}),
      data: { discord_webhook_url: webhookUrl },
    });
    setMessage(error ? error.message : "Settings saved. Email changes may require verification.");
    setLoading(false);
  }

  async function uploadStrategy() {
    if (!strategyFile && !strategyVideoUrl.trim() && !strategyNotes.trim()) {
      setMessage("Add a PDF, YouTube strategy link, or pasted strategy notes.");
      return;
    }
    setLoading(true);
    setMessage("");
    const form = new FormData();
    if (strategyFile) form.append("file", strategyFile);
    form.append("name", strategyName || strategyFile?.name || "OGFX strategy");
    if (strategyVideoUrl.trim()) form.append("youtubeUrl", strategyVideoUrl.trim());
    if (strategyNotes.trim()) form.append("notes", strategyNotes.trim());
    const response = await fetch("/api/ai/parse-strategy", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok ? `Strategy saved. Preview: ${payload.textPreview}${payload.warning ? ` Warning: ${payload.warning}` : ""}` : payload.error || "Upload failed");
    if (response.ok) {
      setStrategyFile(null);
      setStrategyVideoUrl("");
      setStrategyNotes("");
    }
    await load();
    setLoading(false);
  }

  async function setActiveStrategy(id: string) {
    setLoading(true);
    await supabase.from("user_strategies").update({ is_active: false }).eq("user_id", userId);
    const { error } = await supabase.from("user_strategies").update({ is_active: true }).eq("id", id).eq("user_id", userId);
    setMessage(error ? error.message : "Active strategy updated.");
    await load();
    setLoading(false);
  }

  async function saveDemo() {
    setLoading(true);
    setMessage("");
    await supabase.from("profiles").update({
      demo_balance: startingBalance,
      demo_equity: startingBalance,
      risk_percent: riskPerTrade,
      updated_at: new Date().toISOString(),
    }).eq("id", userId);

    await fetch("/api/demo/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initialBalance: startingBalance }),
    });

    const response = await fetch("/api/demo/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        autoTradingEnabled: Boolean(settings?.auto_trading_enabled),
        riskPerTrade: riskPerTrade / 100,
        maxOpenTrades: Number(settings?.max_open_trades ?? 5),
        defaultSize,
        leverage,
        watchedAssets: settings?.watched_assets ?? ["XAUUSD", "EURUSD"],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Demo account settings saved." : payload.error || "Demo settings failed");
    await load();
    setLoading(false);
  }

  function patchExchange(exchangeName: string, value: Partial<{ apiKey: string; secret: string; isActive: boolean }>) {
    setExchangeDrafts((current) => ({
      ...current,
      [exchangeName]: {
        apiKey: current[exchangeName]?.apiKey || "",
        secret: current[exchangeName]?.secret || "",
        isActive: current[exchangeName]?.isActive ?? Boolean(exchangeRows.find((row) => row.exchangeName === exchangeName)?.isActive),
        ...value,
      },
    }));
  }

  async function saveExchange(exchangeName: string) {
    const draft = exchangeDrafts[exchangeName];
    if (!draft?.apiKey || !draft?.secret) {
      setMessage("Add both API key and secret before saving.");
      return;
    }
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/arb/exchange/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exchangeName, ...draft }),
    });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok ? `${exchangeName} API keys saved encrypted. Paper mode remains active.` : payload.error || "Exchange save failed");
    setExchangeDrafts((current) => ({ ...current, [exchangeName]: { apiKey: "", secret: "", isActive: draft.isActive } }));
    await load();
    setLoading(false);
  }

  async function testExchange(exchangeName: string) {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/arb/exchange/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exchangeName }),
    });
    const payload = await response.json().catch(() => ({}));
    setMessage(payload.message || (response.ok ? `${exchangeName} checked.` : payload.error || "Connection test failed"));
    setLoading(false);
  }

  const connectedExchanges = exchangeRows.filter((row) => row.hasApiKey && row.hasSecret && row.isActive).length;

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Workspace controls"
        title="Settings"
        description="Manage profile, strategy PDFs, demo account controls, and access status."
      />

      <div className="flex flex-wrap gap-2">
        {(["profile", "strategy", "demo", "exchange", "access"] as Tab[]).map((item) => (
          <button key={item} onClick={() => setTab(item)} className={`rounded-full border px-4 py-2 text-sm capitalize ${tab === item ? "border-cyan-300/50 bg-cyan-300/10 text-white" : "border-white/10 text-slate-400"}`}>
            {item}
          </button>
        ))}
      </div>

      {message ? <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">{message}</div> : null}

      {tab === "profile" && (
        <Card className="rounded-3xl border-white/10 bg-[#0b1420]/84">
          <CardHeader><CardTitle className="text-white">Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <label className="block text-sm text-slate-400">Email<input value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white" /></label>
            <label className="block text-sm text-slate-400">New password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank to keep current password" className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white" /></label>
            <label className="block text-sm text-slate-400">Discord webhook URL<input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://discord.com/api/webhooks/..." className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white" /></label>
            <Button onClick={saveAccount} disabled={loading} className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save profile</Button>
          </CardContent>
        </Card>
      )}

      {tab === "strategy" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-3xl border-white/10 bg-[#0b1420]/84">
            <CardHeader><CardTitle className="flex items-center gap-2 text-white"><FileText className="h-4 w-4 text-cyan-200" /> Strategy sources</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <input value={strategyName} onChange={(event) => setStrategyName(event.target.value)} className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white" />
              <input type="file" accept="application/pdf" onChange={(event) => setStrategyFile(event.target.files?.[0] ?? null)} className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-xl file:border-0 file:bg-amber-300 file:px-4 file:py-2 file:font-semibold file:text-black" />
              <label className="block text-sm text-slate-400">
                <span className="mb-2 flex items-center gap-2"><Link2 className="h-4 w-4 text-cyan-200" /> YouTube strategy link</span>
                <input value={strategyVideoUrl} onChange={(event) => setStrategyVideoUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." className="h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white" />
              </label>
              <textarea value={strategyNotes} onChange={(event) => setStrategyNotes(event.target.value)} placeholder="Optional notes if the video has no captions, or your own refined rules." className="min-h-28 w-full rounded-2xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none" />
              <Button onClick={uploadStrategy} disabled={loading} variant="glass" className="rounded-xl">Save strategy</Button>
            </CardContent>
          </Card>
          <Card className="rounded-3xl border-white/10 bg-[#0b1420]/84">
            <CardHeader><CardTitle className="text-white">Saved strategies</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {strategies.length ? strategies.map((strategy) => (
                <div key={strategy.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div><div className="font-semibold text-white">{strategy.name}</div><div className="text-xs text-slate-500">{strategy.is_active ? "Active" : new Date(strategy.created_at).toLocaleDateString()}</div></div>
                  <Button onClick={() => setActiveStrategy(strategy.id)} disabled={loading || strategy.is_active} variant="glass" className="rounded-xl">Set active</Button>
                </div>
              )) : <div className="text-sm text-slate-400">No strategy uploaded yet.</div>}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "demo" && (
        <Card className="rounded-3xl border-white/10 bg-[#0b1420]/84">
          <CardHeader><CardTitle className="flex items-center gap-2 text-white"><Shield className="h-4 w-4 text-emerald-200" /> Demo account</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <label className="text-sm text-slate-400">Balance<input type="number" value={startingBalance} onChange={(event) => setStartingBalance(Number(event.target.value))} className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 font-mono text-white" /></label>
            <label className="text-sm text-slate-400">Risk %<input type="number" min="0.1" max="5" step="0.1" value={riskPerTrade} onChange={(event) => setRiskPerTrade(Number(event.target.value))} className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 font-mono text-white" /></label>
            <label className="text-sm text-slate-400">Default lot size<input type="number" min="0.01" step="0.01" value={defaultSize} onChange={(event) => setDefaultSize(Number(event.target.value))} className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 font-mono text-white" /></label>
            <label className="text-sm text-slate-400">Leverage<select value={leverage} onChange={(event) => setLeverage(Number(event.target.value))} className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 font-mono text-white">{[20, 50, 100, 200, 500, 1000].map((value) => <option key={value} value={value}>1:{value}</option>)}</select></label>
            <div className="md:col-span-4"><Button onClick={saveDemo} disabled={loading} className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">Save demo account</Button></div>
          </CardContent>
        </Card>
      )}

      {tab === "exchange" && (
        <Card className="rounded-3xl border-emerald-300/15 bg-[#06130b]/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <KeyRound className="h-4 w-4 text-emerald-200" />
              Exchange API Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
              Keys are stored encrypted server-side. Arb Engine stays paper-only; live trading mode is disabled until at least two exchanges are connected and a separate live execution flow is enabled.
            </div>

            <div className="grid gap-3">
              {EXCHANGE_NAMES.map((exchangeName) => {
                const row = exchangeRows.find((item) => item.exchangeName === exchangeName);
                const draft = exchangeDrafts[exchangeName] || { apiKey: "", secret: "", isActive: Boolean(row?.isActive) };
                return (
                  <div key={exchangeName} className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 lg:grid-cols-[150px_1fr_1fr_120px_120px] lg:items-center">
                    <div>
                      <div className="font-semibold text-white">{exchangeName}</div>
                      <div className={row?.hasApiKey && row?.hasSecret ? "text-xs text-emerald-200" : "text-xs text-slate-500"}>
                        {row?.hasApiKey && row?.hasSecret ? "Stored" : "Not connected"}
                      </div>
                    </div>
                    <input
                      type="password"
                      value={draft.apiKey}
                      onChange={(event) => patchExchange(exchangeName, { apiKey: event.target.value })}
                      placeholder={row?.hasApiKey ? "API key saved" : "API key"}
                      className="h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none focus:border-emerald-300/40"
                    />
                    <input
                      type="password"
                      value={draft.secret}
                      onChange={(event) => patchExchange(exchangeName, { secret: event.target.value })}
                      placeholder={row?.hasSecret ? "Secret saved" : "Secret"}
                      className="h-11 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none focus:border-emerald-300/40"
                    />
                    <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.isActive)}
                        onChange={(event) => patchExchange(exchangeName, { isActive: event.target.checked })}
                      />
                      Active
                    </label>
                    <div className="flex gap-2">
                      <Button onClick={() => saveExchange(exchangeName)} disabled={loading} variant="glass" className="h-10 rounded-xl px-3">Save</Button>
                      <Button onClick={() => testExchange(exchangeName)} disabled={loading} variant="glass" className="h-10 rounded-xl px-3">Test</Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 font-semibold text-white"><PlugZap className="h-4 w-4 text-emerald-200" /> Live trading mode</div>
                <div className="text-sm text-slate-400">{connectedExchanges}/2 required exchange connections. Disabled for this paper-trading phase.</div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={liveModeRequested} onChange={(event) => setLiveModeRequested(event.target.checked)} disabled={connectedExchanges < 2} />
                Request live mode
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "access" && (
        <Card className="rounded-3xl border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),rgba(255,255,255,0.035))]">
          <CardHeader><CardTitle className="flex items-center gap-2 text-white"><CheckCircle2 className="h-4 w-4 text-emerald-200" /> Access</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
              All dashboard features, AI tools, generated signals, backtests, and demo automation are unlocked while billing is paused.
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
              Stored plan record: <b className="uppercase text-white">{profile?.subscription_tier ?? "free"}</b> / {profile?.subscription_status ?? "inactive"}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
