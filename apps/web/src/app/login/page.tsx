import type { Metadata } from "next";
import Link from "next/link";
import { CubeGlyph } from "@/components/cube";
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
    <div className="flex min-h-dvh flex-col bg-carbon">
      <PointerLight />
      <header className="flex items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2.5">
          <CubeGlyph size={18} />
          <span className="font-brand text-[17px] font-extrabold tracking-[-0.01em] text-bone">Palisec<span className="text-citrine">Wall</span></span>
        </span>
        <span className="rounded-[4px] bg-citrine/[0.06] px-1.5 py-0.5 font-utility text-[9.5px] uppercase tracking-[0.08em] text-citrine shadow-[inset_0_0_0_1px_rgb(229_255_93/0.4)]">
          ● Testnet · pre-release
        </span>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px]">
          <h1 className="font-heading text-[28px] font-bold leading-tight text-bone">Sign in to Palisec</h1>
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
            in Settings.
          </p>
        </div>
      </main>

      <footer className="flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-line px-6 py-4 font-utility text-[10.5px] uppercase tracking-[0.08em]">
        {[
          ["/", "Overview"],
          ["/docs/quickstart", "Quickstart"],
          ["/docs", "Docs"],
          ["/security", "Security model"],
          ["/status", "Status"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="text-stone transition-colors hover:text-citrine">{label}</Link>
        ))}
      </footer>
    </div>
  );
}
