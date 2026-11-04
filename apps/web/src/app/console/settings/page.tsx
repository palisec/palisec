import type { Metadata } from "next";
import { LiveSettings } from "@/components/console/live/settings";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <LiveSettings />;
}
