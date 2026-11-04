import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveOperations } from "@/components/console/live/operations";

export const metadata: Metadata = { title: "Operations" };

export default function Page() {
  return <Suspense><LiveOperations /></Suspense>;
}
