import type { Metadata } from "next";
import { ConsoleShell } from "@/components/console/shell";

// Console data is never indexed (spec §9.6), simulated or not.
export const metadata: Metadata = {
  title: { default: "Console", template: "%s · Console · Palisec" },
  description: "Palisec developer console, running as a local simulation workspace.",
  robots: { index: false, follow: false },
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
