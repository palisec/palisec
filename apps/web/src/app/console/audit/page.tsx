import type { Metadata } from "next";
import { AuditView } from "@/components/console/audit";

export const metadata: Metadata = { title: "Audit and forensics" };

export default function Page() {
  return <AuditView />;
}
