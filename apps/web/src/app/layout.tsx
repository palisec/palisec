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
    default: "Palisec · Limits AI agents can't override",
    template: "%s · Palisec",
  },
  description:
    "Smart accounts for AI agents on Robinhood Chain. Spend caps, loss limits and holder-voted rules, enforced on chain and verifiable by anyone.",
  openGraph: {
    type: "website",
    siteName: "Palisec",
    title: "Palisec · Limits AI agents can't override",
    description: "Agents decide. Palisec enforces the limits, on chain.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Palisec · Limits AI agents can't override",
    description: "Agents decide. Palisec enforces the limits, on chain.",
  },
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
        {/* The homepage's opening animation plays once per session, and never with reduced motion. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var h=document.documentElement;if(location.pathname==='/'){if(sessionStorage.getItem('palisec-intro')){h.setAttribute('data-intro','done')}else{sessionStorage.setItem('palisec-intro','1');if(!matchMedia('(prefers-reduced-motion: reduce)').matches){h.classList.add('intro-page');setTimeout(function(){h.classList.remove('intro-page')},5200)}}}}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
