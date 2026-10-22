import type { Metadata } from "next";
import { OperationsView } from "@/components/console/operations";

export const metadata: Metadata = { title: "Operations" };

export default function Page() {
  return <OperationsView />;
}
