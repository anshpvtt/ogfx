import { SiteNav } from "@/components/marketing/SiteNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { Glow } from "@/components/marketing/Glow";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0B0F19] relative">
      <Glow />
      <div className="relative z-10">
        <SiteNav />
        {children}
        <SiteFooter />
      </div>
    </div>
  );
}

