import { cn } from "@/lib/utils";

export function Glow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
    >
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[480px] w-[980px] bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.14)_0%,transparent_70%)] blur-2xl" />
      <div className="absolute top-40 right-[-220px] h-[520px] w-[520px] bg-[radial-gradient(circle,rgba(34,211,238,0.10)_0%,transparent_65%)] blur-2xl" />
      <div className="absolute bottom-[-260px] left-[-200px] h-[640px] w-[640px] bg-[radial-gradient(circle,rgba(99,102,241,0.08)_0%,transparent_65%)] blur-2xl" />
    </div>
  );
}

