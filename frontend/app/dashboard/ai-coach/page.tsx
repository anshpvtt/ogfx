"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Image as ImageIcon, Loader2, Paperclip, Send, Sparkles, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  attachments?: Attachment[];
};

type Strategy = {
  id: string;
  name: string;
  is_active: boolean;
};

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

export default function AiCoachPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategyId, setStrategyId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
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

  async function addFiles(fileList: FileList | File[]) {
    setNotice("");
    const files = Array.from(fileList);
    const openSlots = Math.max(0, MAX_IMAGES - attachments.length);
    const accepted = files.filter((file) => file.type.startsWith("image/")).slice(0, openSlots);
    const skipped: string[] = [];

    if (files.length > openSlots) skipped.push(`Only ${MAX_IMAGES} images can be attached.`);

    const next = await Promise.all(
      accepted.flatMap((file) => {
        if (file.size > MAX_IMAGE_BYTES) {
          skipped.push(`${file.name} is larger than 5 MB.`);
          return [];
        }
        return [fileToDataUrl(file).then((dataUrl) => ({
          id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
          name: file.name,
          type: file.type || "image/png",
          size: file.size,
          dataUrl,
        }))];
      })
    );

    setAttachments((current) => [...current, ...next]);
    if (skipped.length) setNotice(skipped.join(" "));
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function send(message = input) {
    const outgoingAttachments = attachments;
    const content = message.trim() || (outgoingAttachments.length ? "Analyze the attached image(s) with my OGFX context." : "");
    if (!content || loading) return;

    setInput("");
    setAttachments([]);
    setNotice("");
    setMessages((current) => [...current, { role: "user", content, attachments: outgoingAttachments }]);
    setLoading(true);

    try {
      const response = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: content,
          strategyId: strategyId || undefined,
          images: outgoingAttachments.map((attachment) => ({
            name: attachment.name,
            mimeType: attachment.type,
            size: attachment.size,
            dataUrl: attachment.dataUrl,
          })),
          context: {
            source: "dashboard-ai-coach",
            localStats: stats,
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.message) {
        setConversationId(payload.conversationId || conversationId);
        setMessages((current) => [...current, payload.message]);
        if (payload?.contextSummary?.saveError) setNotice(payload.contextSummary.saveError);
      } else {
        setMessages((current) => [...current, { role: "assistant", content: payload?.error || "AI coach failed." }]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: error instanceof Error ? error.message : "AI coach failed." },
      ]);
    } finally {
      setLoading(false);
    }
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
              Ask the coach to review your demo trades, uploaded strategy, or today&apos;s SMC discipline.
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={`${message.timestamp}-${index}`}
              className={`max-w-3xl rounded-2xl p-4 text-sm leading-6 ${
                message.role === "user"
                  ? "ml-auto bg-cyan-300 text-black"
                  : "border border-white/10 bg-white/[0.04] text-slate-100"
              }`}
            >
              {message.attachments?.length ? (
                <div className="mb-3 flex flex-wrap gap-2">
                  {message.attachments.map((attachment) => (
                    <div key={attachment.id} className="overflow-hidden rounded-xl border border-black/10 bg-black/10">
                      <img src={attachment.dataUrl} alt={attachment.name} className="h-20 w-28 object-cover" />
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-cyan-200">
              <Loader2 className="h-4 w-4 animate-spin" />
              Coach is reading your context...
            </div>
          )}
        </div>

        <div className="border-t border-white/10 p-4">
          {attachments.length ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  <img src={attachment.dataUrl} alt={attachment.name} className="h-20 w-28 object-cover" />
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white opacity-90"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {notice ? <div className="mb-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{notice}</div> : null}

          <div className="flex gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/30 text-slate-300 hover:border-cyan-300/40 hover:text-white"
              title="Attach image"
              aria-label="Attach image"
            >
              {attachments.length ? <ImageIcon className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
            </button>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                if (files.length) {
                  event.preventDefault();
                  addFiles(files);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Ask about your edge, discipline, recent trades, or chart..."
              rows={1}
              className="max-h-36 min-h-12 min-w-0 flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-cyan-300/40"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={loading}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-cyan-300 font-black text-black disabled:opacity-60"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
