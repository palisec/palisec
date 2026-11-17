import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ParticleSphere } from "@/components/particle-sphere";
import { PointerLight } from "@/components/pointer-light";
import { WalletSignIn } from "@/components/wallet-sign-in";

export const metadata: Metadata = {
  title: "Sign in",
  alternates: { canonical: "/login" },
  description: "Sign in to Palisec with your wallet.",
  robots: { index: false, follow: false },
};

/** The front door: palisec.tech sends everyone without a session here. */
export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-abyss">
      <PointerLight />
      <header className="relative flex items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2.5">
          <BrandMark size={22} />
          <span className="font-brand text-[17px] font-semibold tracking-[-0.03em] text-mist">Pali<span className="text-aqua">sec</span></span>
        </span>
        <span className="rounded-[4px] bg-aqua/[0.06] px-1.5 py-0.5 font-utility text-[11.5px] text-aqua shadow-[inset_0_0_0_1px_rgb(156_246_238/0.4)]">
          ● Robinhood Chain
        </span>
      </header>

      <ParticleSphere className="pointer-events-none fixed left-1/2 top-1/2 h-[min(900px,130vw)] w-[min(900px,130vw)] -translate-x-1/2 -translate-y-1/2 opacity-60" speed={0.00008} />
      <main id="main" className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px]">
          <h1 className="font-heading text-[28px] font-medium tracking-[-0.02em] leading-tight text-mist">Sign in to Palisec</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The authorization boundary for your on-chain agents: policies, budgets and human approvals checked before every transaction.
          </p>
          <div className="panel panel-beam mt-6 overflow-hidden">
            <div className="border-b border-line px-6 py-4">
              <p className="label">Wallet sign-in · EIP-4361</p>
            </div>
            <WalletSignIn />
          </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
            New here? Signing in for the first time creates your organization with you as owner. Teammates are added by wallet address
            in Settings. By signing in you agree to the{" "}
            <Link href="/terms" className="text-mist underline decoration-aqua/50 underline-offset-4 hover:text-aqua">Terms of Service</Link> and
            acknowledge the{" "}
            <Link href="/privacy" className="text-mist underline decoration-aqua/50 underline-offset-4 hover:text-aqua">Privacy Policy</Link>.
          </p>
        </div>
      </main>

      <footer className="relative flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-line px-6 py-4 font-utility text-[12.5px]">
        {[
          ["/", "Overview"],
          ["/docs/quickstart", "Quickstart"],
          ["/docs", "Docs"],
          ["/security", "Security model"],
          ["/status", "Status"],
          ["/terms", "Terms"],
          ["/privacy", "Privacy"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="text-silver transition-colors hover:text-aqua">{label}</Link>
        ))}
      </footer>
    </div>
  );
}
