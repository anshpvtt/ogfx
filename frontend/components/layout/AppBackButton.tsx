"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function AppBackButton({ fallbackHref = "/" }: { fallbackHref?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-gray-200 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </button>
  );
}
