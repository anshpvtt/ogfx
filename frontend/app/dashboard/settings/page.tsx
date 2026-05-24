"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function DashboardSettingsPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      setWebhookUrl((data.user?.user_metadata?.discord_webhook_url as string) ?? "");
    });
  }, []);

  async function saveAccount() {
    setLoading(true);
    setMessage("");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({
      email,
      ...(password ? { password } : {}),
      data: { discord_webhook_url: webhookUrl },
    });
    setMessage(error ? error.message : "Settings saved. Email changes may require verification.");
    setLoading(false);
  }

  async function openPortal() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/stripe/portal", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not open billing portal");
      window.location.href = payload.url;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not open billing portal");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-7">
      <DashboardPageHeader
        eyebrow="Workspace controls"
        title="Settings"
        description="Manage auth, billing, and Discord alert delivery for the OGFX workspace."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-3xl border-white/10 bg-[#0b1420]/84">
          <CardHeader>
            <CardTitle className="text-white">Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block text-sm text-slate-400">
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white outline-none transition-colors focus:border-cyan-300/40" />
            </label>
            <label className="block text-sm text-slate-400">
              New password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank to keep current password" className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-300/40" />
            </label>
            <label className="block text-sm text-slate-400">
              Discord webhook URL
              <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://discord.com/api/webhooks/..." className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/25 px-3 text-white outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-300/40" />
            </label>
            <Button onClick={saveAccount} disabled={loading} className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save settings
            </Button>
            {message ? <div className="text-sm text-slate-400">{message}</div> : null}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),rgba(255,255,255,0.035))]">
          <CardHeader>
            <CardTitle className="text-white">Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-slate-400">
              Stripe Customer Portal handles plan changes, cancellations, invoices, and card updates.
            </p>
            <Button onClick={openPortal} disabled={loading} variant="glass" className="mt-5 rounded-xl">
              Manage subscription
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
