import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

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
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
