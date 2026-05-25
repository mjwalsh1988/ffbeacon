import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DiscordCta } from "@/components/discord-cta";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "FF Beacon",
    template: "%s | FF Beacon",
  },
  description: "Your signal through the fantasy noise.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ffbeacon.com"),
  // Favicons live in /public/img. We explicitly enumerate them so Next.js
  // never falls back to its starter favicon (which still ships as a stale
  // app/favicon.ico when scaffolded) and so browsers pick the highest-
  // fidelity variant they support: SVG first, then PNG, then ICO.
  icons: {
    icon: [
      { url: "/img/favicon.svg", type: "image/svg+xml" },
      { url: "/img/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/img/favicon.ico", sizes: "any" },
    ],
    shortcut: ["/img/favicon.ico"],
    apple: [{ url: "/img/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-black"
        >
          Skip to main content
        </a>
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
        <DiscordCta />
      </body>
    </html>
  );
}
