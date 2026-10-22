import type { Metadata, Viewport } from "next";
import { Anybody, Hanken_Grotesk, Martian_Mono } from "next/font/google";
import "./globals.css";

// Three families, many voices. Anybody's width axis carries display (condensed rampart),
// brand and the reversal band (expanded); Martian Mono carries labels, data and code.
const display = Anybody({ variable: "--font-anybody", subsets: ["latin"], weight: "variable", axes: ["wdth"] });
const body = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"], weight: "variable" });
const mono = Martian_Mono({ variable: "--font-martian", subsets: ["latin"], weight: "variable", axes: ["wdth"] });
const FONT_VARS = [display, body, mono].map((f) => f.variable).join(" ");

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Palisec — Deterministic transaction security",
    template: "%s · Palisec",
  },
  description:
    "A deterministic authorization boundary for autonomous on-chain agents on Robinhood Chain. Policies, spending limits and human approvals are enforced before execution.",
  openGraph: {
    type: "website",
    siteName: "Palisec",
    title: "Palisec — Deterministic transaction security",
    description: "The deterministic boundary between AI intent and on-chain execution.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0d0e0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${FONT_VARS} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
