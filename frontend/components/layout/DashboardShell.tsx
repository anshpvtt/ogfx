"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  CandlestickChart,
  History,
  LayoutDashboard,
  LineChart,
  LogOut,
  Settings,
  Signal,
} from "lucide-react";
import { OgfxLogo } from "@/components/brand/OgfxLogo";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/analyze", label: "Analyze", icon: CandlestickChart },
  { href: "/dashboard/charts", label: "Live Charts", icon: LineChart },
  { href: "/dashboard/signals", label: "Signals", icon: Signal },
  { href: "/dashboard/backtest", label: "Backtest", icon: BarChart3 },
  { href: "/dashboard/history", label: "History", icon: History },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#060b12] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(6,11,18,0.98),rgba(9,18,28,0.94)_48%,rgba(7,10,20,0.98))]" />
        <div className="absolute left-0 top-0 h-[480px] w-[520px] bg-cyan-400/[0.07] blur-3xl" />
        <div className="absolute right-0 top-24 h-[420px] w-[480px] bg-amber-300/[0.06] blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-[360px] w-[520px] bg-blue-500/[0.06] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(125,211,252,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,0.035)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1500px] flex-col lg:flex-row">
        <aside className="border-b border-white/10 bg-[#08111d]/88 px-4 py-4 backdrop-blur-2xl lg:sticky lg:top-0 lg:h-screen lg:w-72 lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
          <div className="flex items-center justify-between gap-4 lg:block">
            <Link href="/" className="flex items-center gap-3">
              <OgfxLogo className="h-11 w-11 rounded-2xl" priority />
              <div>
                <div className="text-sm font-black tracking-[0.26em] text-white">OGFX</div>
                <div className="text-xs text-slate-400">Elite SMC Engine</div>
              </div>
            </Link>

            <div className="hidden rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-200 sm:inline-flex lg:mt-6">
              Live workspace
            </div>
          </div>

          <nav className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:mt-8 lg:flex-col lg:overflow-visible lg:pb-0">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex min-w-max items-center gap-3 rounded-2xl border px-3.5 py-3 text-sm font-medium transition-all lg:min-w-0",
                    active
                      ? "border-cyan-300/30 bg-cyan-300/10 text-white shadow-[0_0_30px_rgba(34,211,238,0.1)]"
                      : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
                  )}
                >
                  <Icon className={cn("h-4 w-4", active ? "text-cyan-200" : "text-slate-500 group-hover:text-cyan-200")} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-7 hidden rounded-3xl border border-white/10 bg-white/[0.035] p-4 lg:block">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Activity className="h-4 w-4 text-emerald-300" />
              Engine status
            </div>
            <div className="mt-4 grid gap-3 text-xs text-slate-400">
              <div className="flex items-center justify-between">
                <span>Signals</span>
                <span className="font-mono text-emerald-200">streaming</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Charts</span>
                <span className="font-mono text-cyan-200">TradingView</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Backtests</span>
                <span className="font-mono text-amber-200">multi-asset</span>
              </div>
            </div>
          </div>

          <Link
            href="/"
            className="mt-4 hidden items-center gap-2 rounded-2xl border border-white/10 px-3.5 py-3 text-sm text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-white lg:flex"
          >
            <LogOut className="h-4 w-4" />
            Public site
          </Link>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
