import type { Metadata } from "next";
import { LiveBilling } from "@/components/console/live/billing";

export const metadata: Metadata = { title: "Billing" };

export default function Page() {
  return <LiveBilling />;
}
