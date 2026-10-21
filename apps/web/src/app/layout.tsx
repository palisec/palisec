import type { Metadata, Viewport } from "next";
import {
  Chakra_Petch,
  IBM_Plex_Sans,
  JetBrains_Mono,
  Major_Mono_Display,
  Michroma,
  Oxanium,
  Rajdhani,
  Share_Tech_Mono,
  Silkscreen,
  Tektur,
} from "next/font/google";
import "./globals.css";

// One family per typographic role; see globals.css for the role tokens.
const display = Oxanium({ variable: "--font-oxanium", subsets: ["latin"], weight: ["400", "500"] });
const heading = Chakra_Petch({ variable: "--font-chakra", subsets: ["latin"], weight: ["400", "500", "600"] });
const wide = Michroma({ variable: "--font-michroma", subsets: ["latin"], weight: "400" });
const body = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500"] });
const utility = Share_Tech_Mono({ variable: "--font-sharetech", subsets: ["latin"], weight: "400" });
const pixel = Silkscreen({ variable: "--font-silkscreen", subsets: ["latin"], weight: "400" });
const code = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });
const wordmark = Major_Mono_Display({ variable: "--font-majormono", subsets: ["latin"], weight: "400" });
const brand = Tektur({ variable: "--font-tektur", subsets: ["latin"], weight: ["600"] });
const action = Rajdhani({ variable: "--font-rajdhani", subsets: ["latin"], weight: ["700"] });
const FONT_VARS = [action, display, heading, wide, body, utility, pixel, code, wordmark, brand].map((f) => f.variable).join(" ");

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
  themeColor: "#111111",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${FONT_VARS} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
