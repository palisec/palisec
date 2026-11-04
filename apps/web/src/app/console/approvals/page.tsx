import type { Metadata } from "next";
import { ApprovalsView } from "@/components/console/approvals";
import { LiveApprovals } from "@/components/console/live/approvals";
import { ModeView } from "@/components/console/live/session";

export const metadata: Metadata = { title: "Approval queue" };

export default function Page() {
  return <ModeView live={<LiveApprovals />} simulation={<ApprovalsView />} />;
}
