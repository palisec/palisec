import type { Metadata } from "next";
import { LiveIntegrations } from "@/components/console/live/integrations";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return <LiveIntegrations />;
}
