import type { Metadata } from "next";
import { DashboardView } from "@/components/console/dashboard";
import { LiveDashboard } from "@/components/console/live/dashboard";
import { ModeView } from "@/components/console/live/session";

export const metadata: Metadata = { title: { absolute: "Dashboard · Console · Palisec" } };

export default function Page() {
  return <ModeView live={<LiveDashboard />} simulation={<DashboardView />} />;
}
