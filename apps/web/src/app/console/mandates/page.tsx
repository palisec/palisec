import type { Metadata } from "next";
import { LiveMandates } from "@/components/console/live/mandates";

export const metadata: Metadata = { title: "Mandates" };

export default function Page() {
  return <LiveMandates />;
}
