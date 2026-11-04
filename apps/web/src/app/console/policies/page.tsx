import type { Metadata } from "next";
import { PoliciesView } from "@/components/console/policies";
import { LivePolicies } from "@/components/console/live/policies";
import { ModeView } from "@/components/console/live/session";

export const metadata: Metadata = { title: "Policy editor" };

export default function Page() {
  return <ModeView live={<LivePolicies />} simulation={<PoliciesView />} />;
}
