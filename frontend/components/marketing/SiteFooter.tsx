import Link from "next/link";
import { OgfxLogo } from "@/components/brand/OgfxLogo";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#060b12]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 text-white font-semibold">
              <OgfxLogo className="h-8 w-8 rounded-lg" />
              OGFX
            </div>
            <div className="text-sm text-gray-400 mt-1">
              Premium signals, strict logic, measurable performance.
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <Link className="text-gray-400 hover:text-white transition-colors" href="/pricing">
              Pricing
            </Link>
            <Link className="text-gray-400 hover:text-white transition-colors" href="/dashboard/charts">
              Live Charts
            </Link>
            <Link className="text-gray-400 hover:text-white transition-colors" href="/about">
              About
            </Link>
            <Link className="text-gray-400 hover:text-white transition-colors" href="/privacy">
              Privacy
            </Link>
            <Link className="text-gray-400 hover:text-white transition-colors" href="/dashboard">
              Dashboard
            </Link>
          </div>
        </div>

        <div className="mt-8 text-xs text-gray-500">
          (c) {new Date().getFullYear()} OGFX. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
