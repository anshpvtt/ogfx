"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { OgfxLogo } from "@/components/brand/OgfxLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Home" },
  { href: "/dashboard/charts", label: "Live Charts" },
  { href: "/trading-agent", label: "Trading Agent" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#08111d]/82 backdrop-blur-2xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <OgfxLogo className="h-8 w-8 rounded-lg" priority />
            <span className="text-lg font-black tracking-[0.18em] text-white">OGFX</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "px-3 py-2 rounded-md text-sm transition-colors",
                  pathname === l.href
                    ? "border border-cyan-300/20 bg-cyan-300/10 text-white"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="md:hidden h-10 w-10 inline-flex items-center justify-center rounded-md text-gray-300 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors"
              aria-label="Open menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link
              href="/auth/login"
              className="hidden h-10 items-center justify-center rounded-xl border border-transparent px-4 text-sm text-gray-300 transition-colors hover:border-white/10 hover:bg-white/5 hover:text-white sm:inline-flex"
            >
              Login
            </Link>
            <Button asChild className="rounded-xl bg-cyan-300 text-slate-950 hover:bg-cyan-200">
              <Link href="/dashboard">
                Open dashboard <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {open ? (
          <div className="md:hidden pb-4">
            <div className="space-y-1 rounded-2xl border border-white/10 bg-[#0b1420]/95 p-2">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "block px-3 py-2 rounded-lg text-sm transition-colors",
                    pathname === l.href ? "text-white bg-white/10" : "text-gray-300 hover:text-white hover:bg-white/10"
                  )}
                >
                  {l.label}
                </Link>
              ))}
              <div className="h-px bg-white/10 my-1" />
              <Link
                href="/auth/login"
                className="block px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/10"
              >
                Login
              </Link>
              <Link
                href="/dashboard"
                className="block rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200"
              >
                Open dashboard
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
