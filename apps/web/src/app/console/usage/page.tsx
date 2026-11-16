import type { Metadata } from "next";
import { LiveUsage } from "@/components/console/live/usage";

export const metadata: Metadata = { title: "Usage" };

export default function Page() {
  return <LiveUsage />;
}
