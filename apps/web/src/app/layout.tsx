import type { Metadata, Viewport } from "next";
import { Anybody, Funnel_Display, Hanken_Grotesk, Instrument_Sans, Martian_Mono } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/site";

// Five families, one job each:
//   Funnel Display  headings and the hero, medium weight only
//   Instrument Sans navigation, buttons and sentence-case labels
//   Hanken Grotesk  body copy
//   Martian Mono    codes, figures, addresses and data
//   Anybody         the wordmark and oversized kinetic type (its width axis animates)
const heading = Funnel_Display({ variable: "--font-funnel", subsets: ["latin"], weight: "variable" });
const ui = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"], weight: "variable", axes: ["wdth"] });
const body = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"], weight: "variable" });
const mono = Martian_Mono({ variable: "--font-martian", subsets: ["latin"], weight: "variable", axes: ["wdth"] });
const kinetic = Anybody({ variable: "--font-anybody", subsets: ["latin"], weight: "variable", axes: ["wdth"] });
const FONT_VARS = [heading, ui, body, mono, kinetic].map((f) => f.variable).join(" ");


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
  themeColor: "#012624",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the inline script adds "js" to <html> before React hydrates.
    <html lang="en" className={`${FONT_VARS} antialiased`} suppressHydrationWarning>
      <head>
        {/* Reveal animations only hide content once script is known to run; without it, everything renders in place. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
