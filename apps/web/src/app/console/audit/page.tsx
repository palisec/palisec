import type { Metadata } from "next";
import { AuditView } from "@/components/console/audit";
import { LiveAudit } from "@/components/console/live/audit";
import { ModeView } from "@/components/console/live/session";

export const metadata: Metadata = { title: "Audit and forensics" };

export default function Page() {
  return <ModeView live={<LiveAudit />} simulation={<AuditView />} />;
}
