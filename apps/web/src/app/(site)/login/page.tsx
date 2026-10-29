import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { WalletSignIn } from "@/components/wallet-sign-in";

export const metadata: Metadata = {
  title: "Sign in",
  alternates: { canonical: "/login" },
  description: "Sign in to the Palisec developer console.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <Container className="flex min-h-[70vh] items-center justify-center py-16">
      <div className="panel panel-beam w-full max-w-[400px] overflow-hidden">
        <div className="border-b border-line px-6 py-4">
          <p className="label">Developer console</p>
          <h1 className="mt-2 text-xl font-medium text-fg">Sign in</h1>
        </div>
        <WalletSignIn />
      </div>
    </Container>
  );
}
