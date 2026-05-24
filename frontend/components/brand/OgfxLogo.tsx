import Image from "next/image";
import { cn } from "@/lib/utils";

export function OgfxLogo({
  className,
  imageClassName,
  priority = false,
}: {
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-grid overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_0_24px_rgba(34,211,238,0.12)]",
        className
      )}
      aria-hidden="true"
    >
      <Image
        src="/ogfx-logo.png"
        alt=""
        fill
        sizes="64px"
        priority={priority}
        className={cn("scale-[2.45] object-cover object-center", imageClassName)}
      />
    </span>
  );
}
