import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to the Palisec developer console.",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <Container className="flex min-h-[70vh] items-center justify-center py-16">
      <div className="w-full max-w-[400px] border border-line bg-surface">
        <div className="border-b border-line px-6 py-4">
          <p className="label">Developer console</p>
          <h1 className="mt-2 text-xl font-medium text-fg">Sign in</h1>
        </div>
        <div className="space-y-3 px-6 py-6">
          <button type="button" disabled className="flex h-11 w-full items-center justify-between border border-line-strong px-4 text-sm text-soft disabled:cursor-not-allowed disabled:opacity-50">
            Sign in with wallet
            <span className="font-mono text-[10px] text-dim">SIWE</span>
          </button>
          <button type="button" disabled className="flex h-11 w-full items-center justify-between border border-line px-4 text-sm text-soft disabled:cursor-not-allowed disabled:opacity-50">
            Continue with GitHub
            <span className="font-mono text-[10px] text-dim">OAUTH</span>
          </button>
        </div>
        <div className="border-t border-line px-6 py-4">
          <p className="font-mono text-[11px] tracking-[0.08em] text-review">◆ AUTHENTICATION SERVICE NOT DEPLOYED</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Sign-in is disabled until the control plane exists. Meanwhile, try the{" "}
            <Link href="/#workbench" className="text-fg underline decoration-line-strong underline-offset-4">policy workbench</Link>.
          </p>
        </div>
      </div>
    </Container>
  );
}
