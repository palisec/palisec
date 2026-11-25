import { CommandMenu } from "@/components/command-menu";
import { LineFooter } from "@/components/line/site-footer";
import { SiteNav } from "@/components/line/site-nav";
import { SideLabels, TheLine } from "@/components/line/line";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="line-site relative min-h-dvh">
      <TheLine />
      <SiteNav />
      <main id="main" className="relative z-[1]">
        <SideLabels />
        {children}
      </main>
      <LineFooter />
      <CommandMenu />
    </div>
  );
}
