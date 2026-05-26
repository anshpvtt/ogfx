"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Lock, Mail, Shield } from "lucide-react";
import { OgfxLogo } from "@/components/brand/OgfxLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthClient({ initialMode = "login" }: { initialMode?: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const errorParam = searchParams.get("error");

  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();

      if (mode === "signup") {
        const origin = window.location.origin;
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
          },
        });
        if (signUpError) throw signUpError;
        setSent(true);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        router.push(next);
        router.refresh();
      }
    } catch (err: any) {
      setError(err?.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060b12] p-4">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.08),transparent_38%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <OgfxLogo className="mb-4 h-16 w-16 rounded-2xl" priority />
          <h1 className="text-2xl font-black text-white">Welcome to OGFX</h1>
          <p className="mt-2 text-slate-400">Premium trading signals platform</p>
        </div>

        <div>
          <Card className="rounded-3xl border-white/10 bg-[#0b1420]/92 shadow-[0_30px_110px_rgba(0,0,0,0.35)]">
            <CardHeader className="text-center">
              <CardTitle className="text-xl text-white">{mode === "login" ? "Sign in" : "Create account"}</CardTitle>
              <CardDescription className="text-slate-400">
                {mode === "login" ? "Use your email and password" : "We'll send a verification link to your email"}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {sent ? (
                <div className="space-y-4 text-center">
                  <div className="font-medium text-white">Check your email</div>
                  <div className="text-sm text-slate-400">
                    We sent a verification link to <span className="text-white">{email}</span>. Open it to activate your account.
                  </div>
                  <Button type="button" variant="glass" className="w-full rounded-xl" onClick={() => setSent(false)}>
                    Back
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {(errorParam || error) && (
                    <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                      {error ? error : "Authentication error. Please try again."}
                    </div>
                  )}

                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@domain.com"
                      className="w-full rounded-2xl border border-white/10 bg-black/25 py-3 pl-11 pr-4 text-white transition-colors placeholder:text-slate-600 focus:border-cyan-300/40 focus:outline-none"
                      required
                    />
                  </div>

                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Password"
                      className="w-full rounded-2xl border border-white/10 bg-black/25 py-3 pl-11 pr-4 text-white transition-colors placeholder:text-slate-600 focus:border-cyan-300/40 focus:outline-none"
                      required
                    />
                  </div>

                  <Button type="submit" className="h-12 w-full rounded-2xl bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={isLoading}>
                    {isLoading ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950" />
                    ) : (
                      <>
                        {mode === "login" ? "Sign in" : "Create account"}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>

                  <Link
                    className="block w-full text-center text-sm text-slate-400 transition-colors hover:text-white"
                    href={mode === "login" ? "/auth/signup" : "/auth/login"}
                  >
                    {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
                  </Link>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Shield className="h-4 w-4" />
          <span>Email verification via Supabase</span>
        </div>

        <div className="mt-4 text-center">
          <Link href="/" className="text-sm text-slate-500 transition-colors hover:text-slate-300">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
