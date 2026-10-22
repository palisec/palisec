import type { Metadata } from "next";
import { SettingsView } from "@/components/console/settings";

export const metadata: Metadata = { title: "Organization and access" };

export default function Page() {
  return <SettingsView />;
}
