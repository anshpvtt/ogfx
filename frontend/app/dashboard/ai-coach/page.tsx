"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
};

type Strategy = {
  id: string;
  name: string;
  is_active: boolean;
};

export default function AiCoachPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategyId, setStrategyId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ trades: 0, winRate: 0, avgPnl: 0 });

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: strategyRows } = await supabase
        .from("user_strategies")
        .select("id,name,is_active")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setStrategies(strategyRows ?? []);
      setStrategyId(strategyRows?.find((item) => item.is_active)?.id || strategyRows?.[0]?.id || "");

      const { data: orders } = await supabase
        .from("demo_orders")
        .select("pnl,status")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      const closed = (orders ?? []).filter((order: any) => order.status !== "OPEN");
      const wins = closed.filter((order: any) => Number(order.pnl) > 0).length;
      const pnl = closed.reduce((sum: number, order: any) => sum + Number(order.pnl || 0), 0);
      setStats({
        trades: closed.length,
        winRate: closed.length ? Math.round((wins / closed.length) * 100) : 0,
        avgPnl: closed.length ? Number((pnl / closed.length).toFixed(2)) : 0,
      });
    }
    load();
  }, [supabase]);

  async function send(message = input) {
    const content = message.trim();
    if (!content || loading) return;
    setInput("");
    setMessages((current) => [...current, { role: "user", content }]);
    setLoading(true);

    const response = await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message: content, strategyId: strategyId || undefined }),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      setConversationId(payload.conversationId);
      setMessages((current) => [...current, payload.message]);
    } else {
      setMessages((current) => [...current, { role: "assistant", content: payload?.error || "AI coach failed." }]);
    }
    setLoading(false);
  }

  return (
    <div className="grid min-h-[calc(100vh-5rem)] gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-300 text-black">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-amber-200">Personal Edge</p>
            <h1 className="font-black">AI Coach</h1>
          </div>
        </div>

        <label className="mt-6 block text-sm text-slate-400">
          Active strategy
          <select
            value={strategyId}
            onChange={(event) => setStrategyId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#08111d] px-3 py-3 text-white"
          >
            <option value="">Standard OGFX SMC</option>
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">Closed trades</span><b>{stats.trades}</b></div>
          <div className="flex justify-between"><span className="text-slate-400">Win rate</span><b>{stats.winRate}%</b></div>
          <div className="flex justify-between"><span className="text-slate-400">Avg P&L</span><b>${stats.avgPnl}</b></div>
        </div>

        <div className="mt-6 grid gap-2">
          {["Review my last 5 trades", "What is my edge today?", "Grade my risk management"].map((prompt) => (
            <button
              key={prompt}
              onClick={() => send(prompt)}
              className="rounded-xl border border-white/10 px-3 py-3 text-left text-sm text-slate-300 hover:border-cyan-300/30 hover:bg-cyan-300/10"
            >
              {prompt}
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-h-[620px] flex-col rounded-3xl border border-white/10 bg-[#08111d]/80">
        <div className="flex items-center justify-between border-b border-white/10 p-5">
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-cyan-200" />
            Gemma strategy coach
          </div>
          <span className="rounded-full border border-amber-200/20 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
            {strategies.find((item) => item.id === strategyId)?.name || "Standard OGFX SMC"}
          </span>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-slate-300">
              Ask the coach to review your demo trades, uploaded strategy, or today’s SMC discipline.
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={`${message.timestamp}-${index}`}
              className={`max-w-3xl whitespace-pre-wrap rounded-2xl p-4 text-sm leading-6 ${
                message.role === "user"
                  ? "ml-auto bg-cyan-300 text-black"
                  : "border border-white/10 bg-white/[0.04] text-slate-100"
              }`}
            >
              {message.content}
            </div>
          ))}
          {loading && <div className="text-sm text-cyan-200">Coach is reading your context...</div>}
        </div>

        <div className="border-t border-white/10 p-4">
          <div className="flex gap-3">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) send();
              }}
              placeholder="Ask about your edge, discipline, or recent trades..."
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-300/40"
            />
            <button onClick={() => send()} className="rounded-xl bg-cyan-300 px-4 py-3 font-black text-black">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
