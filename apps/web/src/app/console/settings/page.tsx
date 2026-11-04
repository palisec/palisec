import type { Metadata } from "next";
import { SettingsView } from "@/components/console/settings";
import { LiveSettings } from "@/components/console/live/settings";
import { ModeView } from "@/components/console/live/session";

export const metadata: Metadata = { title: "Organization and access" };

export default function Page() {
  return <ModeView live={<LiveSettings />} simulation={<SettingsView />} />;
}
