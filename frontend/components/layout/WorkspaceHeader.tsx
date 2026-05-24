"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CandlestickChart, LayoutDashboard, LineChart, Signal, Wallet } from "lucide-react";
import { AppBackButton } from "./AppBackButton";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/analyze", label: "Analyze", icon: CandlestickChart },
  { href: "/dashboard/backtest", label: "Backtest", icon: LineChart },
  { href: "/signals", label: "Signals", icon: Signal },
  { href: "/pricing", label: "Pricing", icon: Wallet },
];

export function WorkspaceHeader({
  title,
  description,
  fallbackHref = "/",
  actions,
}: {
  title: string;
  description: string;
  fallbackHref?: string;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#08101c]/88 backdrop-blur-2xl">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <AppBackButton fallbackHref={fallbackHref} />
                <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
                  OGFX Pro
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
                <p className="mt-1 max-w-3xl text-sm text-slate-400 sm:text-base">{description}</p>
              </div>
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>

          <nav className="flex flex-wrap gap-2">
            {LINKS.map((link) => {
              const active = pathname === link.href;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={[
                    "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all",
                    active
                      ? "border-cyan-400/30 bg-cyan-400/10 text-white shadow-[0_0_28px_rgba(34,211,238,0.12)]"
                      : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
