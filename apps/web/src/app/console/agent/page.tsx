import type { Metadata } from "next";
import { LiveAgentWorkspace } from "@/components/console/live/agent-workspace";

export const metadata: Metadata = { title: "PALISEC Agent" };

export default function Page() {
  return <LiveAgentWorkspace />;
}
