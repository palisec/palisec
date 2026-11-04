import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveAudit } from "@/components/console/live/audit";

export const metadata: Metadata = { title: "Audit" };

export default function Page() {
  return <Suspense><LiveAudit /></Suspense>;
}
