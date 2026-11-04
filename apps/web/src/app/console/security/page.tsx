import type { Metadata } from "next";
import { SecurityView } from "@/components/console/security";
import { LiveSecurity } from "@/components/console/live/security";
import { ModeView } from "@/components/console/live/session";

export const metadata: Metadata = { title: "Keys, attestation and circuit breakers" };

export default function Page() {
  return <ModeView live={<LiveSecurity />} simulation={<SecurityView />} />;
}
