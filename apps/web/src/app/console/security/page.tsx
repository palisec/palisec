import type { Metadata } from "next";
import { SecurityView } from "@/components/console/security";

export const metadata: Metadata = { title: "Keys, attestation and circuit breakers" };

export default function Page() {
  return <SecurityView />;
}
