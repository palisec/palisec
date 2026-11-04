import type { Metadata } from "next";
import { LiveDashboard } from "@/components/console/live/dashboard";

export const metadata: Metadata = { title: { absolute: "Dashboard · Console · Palisec" } };

export default function Page() {
  return <LiveDashboard />;
}
