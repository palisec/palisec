import type { Metadata } from "next";
import { PoliciesView } from "@/components/console/policies";

export const metadata: Metadata = { title: "Policy editor" };

export default function Page() {
  return <PoliciesView />;
}
