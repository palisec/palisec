import type { Metadata } from "next";
import { AgentsView } from "@/components/console/agents";
import { LiveAgents } from "@/components/console/live/agents";
import { ModeView } from "@/components/console/live/session";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return <ModeView live={<LiveAgents />} simulation={<AgentsView />} />;
}
