import type { Metadata } from "next";
import { LiveSecurityEvents } from "@/components/console/live/security-events";

export const metadata: Metadata = { title: "Security events" };

export default function Page() {
  return <LiveSecurityEvents />;
}
