import type { Metadata } from "next";
import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SITE } from "@/lib/site";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DiscordCta } from "@/components/discord-cta";
import { SignalGuideMount } from "@/components/signal-guide/signal-guide-mount";
import { RouteScrollReset } from "@/components/route-scroll-reset";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  AppRailSections,
  AppRailFallback,
} from "@/components/app-shell/app-rail-sections";
import { RailSectionsProvider } from "@/components/app-shell/rail-sections";
import { BreadcrumbLabelProvider } from "@/components/app-shell/breadcrumb-label";
import {
  SidebarProvider,
  SIDEBAR_INIT_SCRIPT,
} from "@/components/app-shell/sidebar-state";
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

/**
 * Deliberately synchronous. An `await` in this function body would block React
 * from descending into `children`, which puts the session read in front of
 * every page's own data fetching instead of alongside it. Both async pieces of
 * chrome, the header and the rail, are children for that reason.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      // The server always says expanded, which is the default, and the
      // blocking script below flips it to collapsed before paint for anyone who
      // closed the rail. That is a deliberate server/client difference on this
      // one attribute, which is what `suppressHydrationWarning` is for; without
      // it React reports the script's own work as a mismatch on every load.
      data-sidebar="expanded"
      suppressHydrationWarning
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        {/* Re-applies the remembered rail width before the first paint, so the
            rail is simply the right width from the first frame instead of
            painting collapsed and snapping open once React hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-black"
        >
          Skip to main content
        </a>
        {/* Route changes must land the reader at the top of the new page. See
            components/route-scroll-reset.tsx for why the App Router does not
            reliably do this on its own. */}
        <RouteScrollReset />
        <SidebarProvider>
          <RailSectionsProvider>
            <BreadcrumbLabelProvider>
            <div className="flex min-h-screen flex-col">
              <SiteHeader />
              <AppShell
                siteUrl={SITE.url}
                rail={
                  <Suspense fallback={<AppRailFallback />}>
                    <AppRailSections />
                  </Suspense>
                }
              >
                {children}
              </AppShell>
              <SiteFooter />
            </div>
            </BreadcrumbLabelProvider>
          </RailSectionsProvider>
        </SidebarProvider>
        <DiscordCta />
        <SignalGuideMount />
        <Analytics />
      </body>
    </html>
  );
}
