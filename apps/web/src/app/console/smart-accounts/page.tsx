import type { Metadata } from "next";
import { LiveSmartAccounts } from "@/components/console/live/smart-accounts";

export const metadata: Metadata = { title: "Smart accounts" };

export default function Page() {
  return <LiveSmartAccounts />;
}
