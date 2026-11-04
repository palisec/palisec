import type { Metadata } from "next";
import { LiveSecurity } from "@/components/console/live/security";

export const metadata: Metadata = { title: "Security" };

export default function Page() {
  return <LiveSecurity />;
}
