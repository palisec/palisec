import type { Metadata } from "next";
import { LiveAgents } from "@/components/console/live/agents";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return <LiveAgents />;
}
