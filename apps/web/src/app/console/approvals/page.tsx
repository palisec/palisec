import type { Metadata } from "next";
import { LiveApprovals } from "@/components/console/live/approvals";

export const metadata: Metadata = { title: "Approvals" };

export default function Page() {
  return <LiveApprovals />;
}
