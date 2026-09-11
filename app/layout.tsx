import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SITE } from "@/lib/site";
import {
  organizationJsonLd,
  serializeJsonLd,
  websiteJsonLd,
} from "@/lib/json-ld";
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
import { BOOKMARK_BAR_INIT_SCRIPT } from "@/components/bookmarks/collapsed-state";
import {
  BookmarkBarSlot,
  BookmarkToggleSlot,
} from "@/components/bookmarks/bookmark-slots";
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
  // fidelity variant they support: PNG first, then ICO.
  //
  // There is deliberately no SVG entry. The file that used to sit here was an
  // SVG wrapper around a base64 PNG, 1.78 MB of it, and being listed first it
  // was what every modern browser downloaded on a first visit. The 5 kB
  // 96 px mark below is the same artwork at the size a tab actually draws.
  icons: {
    icon: [
      { url: "/img/ff-beacon-mark-96.png", sizes: "96x96", type: "image/png" },
      { url: "/img/favicon.ico", sizes: "any" },
    ],
    shortcut: ["/img/favicon.ico"],
    apple: [{ url: "/img/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Default share card for any page that sets no openGraph of its own
  // (/privacy, /terms, the not-found branch of the share page). Next merges
  // metadata shallowly per key, so a page that sets its own openGraph.images
  // does not see this one; a page that sets openGraph without images loses
  // this default image entirely rather than falling back to it, which is
  // why every page that carries a share card sets its own images.
  openGraph: {
    title: SITE.name,
    description: "Your signal through the fantasy noise.",
    url: SITE.url,
    siteName: SITE.name,
    type: "website",
    locale: "en_US",
    images: [
      {
        url: `${SITE.url}/api/og/page/home`,
        width: 1200,
        height: 630,
        alt: "FF Beacon, your signal through the fantasy noise",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.name,
    description: "Your signal through the fantasy noise.",
    images: [`${SITE.url}/api/og/page/home`],
  },
};

export const viewport: Viewport = {
  themeColor: "#07070D",
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
      // Same story as data-sidebar: the server says open, and the blocking
      // script below minimises it before paint for anyone who had.
      data-bookmark-bar="open"
      suppressHydrationWarning
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        {/* Re-applies the remembered rail width before the first paint, so the
            rail is simply the right width from the first frame instead of
            painting collapsed and snapping open once React hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
        {/* Same trick, same reason, for whether the bookmark bar is minimised.
            See components/bookmarks/collapsed-state.ts. */}
        <script dangerouslySetInnerHTML={{ __html: BOOKMARK_BAR_INIT_SCRIPT }} />
        {/* Points an agent at the machine-readable description of the site, the
            way llms.txt v2 recommends. `describedby` is a registered link
            relation (IANA), so this is the standard mechanism rather than an
            invented one, and it costs one tag on a page a crawler already has.
            The corpus itself is linked from inside that file.

            No `type`: the body is markdown but the route serves it as
            text/plain, which is what the llms.txt convention specifies and what
            crawlers expect. Advertising text/markdown here would promise a
            content type the response does not carry. */}
        <link rel="describedby" href={`${SITE.url}/llms.txt`} />
        {/* Organization and WebSite entity schema, once for the whole site.
            No SearchAction: the site search is a command palette with no
            query-string URL to point one at. See lib/json-ld.ts. */}
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd([organizationJsonLd(), websiteJsonLd()]),
          }}
        />
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
              {/* The bookmark bar, full width directly under the header, the
                  way a browser draws one. Its own boundary: it needs an auth
                  read, and nothing else on the page waits for it. Renders
                  nothing for a signed-out reader, on a handheld, or for anyone
                  who has saved no pages. */}
              <Suspense fallback={null}>
                <BookmarkBarSlot />
              </Suspense>
              <AppShell
                siteUrl={SITE.url}
                rail={
                  <Suspense fallback={<AppRailFallback />}>
                    <AppRailSections />
                  </Suspense>
                }
                bookmarkAction={
                  <Suspense fallback={null}>
                    <BookmarkToggleSlot />
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
        {/* Real-user Web Vitals. Page views alone cannot say whether a change
            made the site faster for anyone who is not on the office wifi. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
