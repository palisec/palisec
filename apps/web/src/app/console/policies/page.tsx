import type { Metadata } from "next";
import { LivePolicies } from "@/components/console/live/policies";

export const metadata: Metadata = { title: "Policies" };

export default function Page() {
  return <LivePolicies />;
}
