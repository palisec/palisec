import type { Metadata } from "next";
import { Suspense } from "react";
import { OperationsView } from "@/components/console/operations";
import { LiveOperations } from "@/components/console/live/operations";
import { ModeView } from "@/components/console/live/session";

export const metadata: Metadata = { title: "Operations" };

export default function Page() {
  return <ModeView live={<Suspense><LiveOperations /></Suspense>} simulation={<OperationsView />} />;
}
