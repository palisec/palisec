import type { Metadata } from "next";
import { ApprovalsView } from "@/components/console/approvals";

export const metadata: Metadata = { title: "Approval queue" };

export default function Page() {
  return <ApprovalsView />;
}
