import { Suspense } from "react";
import Link from "next/link";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { loadBeamSettings } from "@/lib/beam/settings";
import { starterExamples } from "@/lib/beam/examples";
import { DEFAULT_FORMAT_SLUG } from "@/lib/site";
import {
  readCookieSlug,
  SOURCE_COOKIE,
  FORMAT_COOKIE,
} from "@/lib/preferences";
import type { FormatLike } from "@/lib/format-fallback";
import { getActiveFormats, getAvailableSources, pickDefaultSource } from "@/lib/source";

import { type FormatOption } from "@/components/format-toggle";
import { type SourceOption } from "@/components/source-toggle";
import { SiteSearch } from "@/components/site-search";
import { PreferencesMenu } from "@/components/preferences-menu";
import { HeaderShell } from "@/components/header-shell";
import { AppMobileNav } from "@/components/app-shell/app-mobile-nav";
import { RailToggle } from "@/components/app-shell/rail-toggle";
import { buildNavTree } from "@/lib/nav-tree";
import { getNavViewer } from "@/lib/nav-viewer";
import { BeamLauncher } from "@/components/beam/beam-launcher";

async function loadHeaderData(): Promise<{
  formats: FormatOption[];
  allFormats: FormatLike[];
  sources: SourceOption[];
  isAuthenticated: boolean;
  isAdmin: boolean;
  preferredFormatSlug: string | null;
  preferredSourceSlug: string | null;
  defaultSourceSlug: string | null;
  beamStarters: string[];
}> {
  try {
    const supabase = await createClient();
    // Cached helpers: page-level callers share these Promises with us.
    // BEAM settings ride along in the same wave: the starter questions in the
    // panel are generated from the capabilities that are actually switched on,
    // so one an admin disables stops being advertised in the same request
    // rather than at the next deploy.
    // The session and the saved defaults come from getNavViewer, which the root
    // layout also calls. It is React-cached, so the two of us share one auth
    // round trip and one user_preferences read per render rather than each
    // making our own.
    const [formats, sources, viewer, beamSettings] = await Promise.all([
      getActiveFormats(supabase),
      getAvailableSources(supabase),
      getNavViewer(),
      loadBeamSettings(createAdminClient()),
    ]);

    let preferredFormatSlug: string | null = null;
    let preferredSourceSlug: string | null = null;
    const isAdmin = viewer.isAdmin;
    if (viewer.isAuthenticated) {
      if (viewer.defaultFormatConfigId) {
        const match = formats.find((f) => f.id === viewer.defaultFormatConfigId);
        if (match) preferredFormatSlug = match.slug;
      }
      if (viewer.defaultSourceSlug) {
        const match = sources.find((s) => s.slug === viewer.defaultSourceSlug);
        if (match) preferredSourceSlug = match.slug;
      }
    }

    if (!preferredFormatSlug) {
      const cookieFormat = await readCookieSlug(FORMAT_COOKIE);
      if (cookieFormat && formats.some((f) => f.slug === cookieFormat)) {
        preferredFormatSlug = cookieFormat;
      }
    }
    if (!preferredSourceSlug) {
      const cookieSource = await readCookieSlug(SOURCE_COOKIE);
      if (cookieSource && sources.some((s) => s.slug === cookieSource)) {
        preferredSourceSlug = cookieSource;
      }
    }

    const allFormats: FormatLike[] = formats.map((f) => ({
      slug: f.slug,
      display_name: f.display_name,
      league_type: f.league_type,
      scoring_type: f.scoring_type,
      is_superflex: f.is_superflex,
      display_order: f.display_order,
    }));

    return {
      formats: formats.map(({ id, slug, display_name, is_default }) => ({
        id,
        slug,
        display_name,
        is_default,
      })) as FormatOption[],
      allFormats,
      sources: sources as SourceOption[],
      isAuthenticated: viewer.isAuthenticated,
      isAdmin,
      preferredFormatSlug,
      preferredSourceSlug,
      defaultSourceSlug: pickDefaultSource(sources),
      beamStarters: starterExamples(beamSettings.capabilities.disabled, 4),
    };
  } catch {
    return {
      formats: [],
      allFormats: [],
      sources: [],
      isAuthenticated: false,
      isAdmin: false,
      preferredFormatSlug: null,
      preferredSourceSlug: null,
      defaultSourceSlug: null,
      beamStarters: starterExamples([], 4),
    };
  }
}

export async function SiteHeader() {
  const {
    formats,
    allFormats,
    sources,
    isAuthenticated,
    isAdmin,
    preferredFormatSlug,
    preferredSourceSlug,
    defaultSourceSlug,
    beamStarters,
  } = await loadHeaderData();
  const initialFormatSlug = preferredFormatSlug ?? DEFAULT_FORMAT_SLUG;
  // Mirror lib/preferences.ts resolveSourceSlug: a saved preference wins, else
  // the DB-backed site-wide default (source_registry.is_default), else the first
  // source in display order. No hardcoded default slug.
  const initialSourceSlug =
    preferredSourceSlug ?? defaultSourceSlug ?? sources[0]?.slug ?? null;
  const fallbackFormats: FormatOption[] = formats.length
    ? formats
    : [
        { id: "fallback", slug: DEFAULT_FORMAT_SLUG, display_name: "Redraft PPR", is_default: true },
      ];

  // What does the resolved source support? Used to gate the Format dropdown.
  // Filtered on the server for the same reason the rail's is: the tree names
  // every admin route, and the drawer is a client component. Built from the
  // cached viewer object so this is the same array the rail gets and Flight
  // serialises it once rather than twice.
  const navSections = buildNavTree(await getNavViewer());

  const activeSource = sources.find((s) => s.slug === initialSourceSlug) ?? null;
  const supportedFormatSlugs = activeSource?.supported_format_slugs ?? null;

  return (
    <HeaderShell>
      {/* Brand cell. Its width tracks the navigation rail below it, so the logo
          and the rail read as one piece of chrome: narrow the rail and only the
          mark is left, widen it and the wordmark comes back. */}
      <div className="app-header-brand flex h-full shrink-0 items-center justify-center border-r border-line px-3">
        <Link
          href="/"
          aria-label="FF Beacon home"
          className="flex min-w-0 items-center gap-2.5 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/img/ff-beacon-mark-96.png"
            alt=""
            width={34}
            height={34}
            style={{ width: 34, height: 34 }}
            className="shrink-0"
          />
          <span
            aria-hidden="true"
            className="app-header-wordmark truncate bg-clip-text text-lg font-semibold text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, #FFFFFF 0%, #FFFFFF 55%, #EDE6FF 85%, #DDD0FF 100%)",
            }}
          >
            FF Beacon
          </span>
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 sm:px-4 lg:px-6">
        {/* Rail width on desktop, navigation drawer on a phone. Only ever one
            of the two is rendered at a given width. */}
        <RailToggle />
        <Suspense fallback={<NavTriggerSkeleton />}>
          <AppMobileNav
            sections={navSections}
            viewer={{ isAuthenticated, isAdmin }}
            formats={fallbackFormats}
            initialFormatSlug={initialFormatSlug}
            sources={sources}
            initialSourceSlug={initialSourceSlug}
            allFormats={allFormats}
            supportedFormatSlugs={supportedFormatSlugs}
          />
        </Suspense>

        <div className="ml-auto flex items-center gap-2">
          {/* Site search: icon trigger visible on every breakpoint, opens the
              accessible search palette (players, articles, tools). */}
          <SiteSearch />
          {/* Ask BEAM: the same reach as search, at every breakpoint, because
              it answers the questions search cannot. Opens the slide-in panel. */}
          <BeamLauncher starters={beamStarters} />
          {/* Desktop: source + format toggles are tucked into a single popover
              to save header space. The navigation drawer carries the same two
              controls at smaller widths. */}
          <div className="hidden md:block">
            <Suspense fallback={<TogglePillSkeleton />}>
              <PreferencesMenu
                formats={fallbackFormats}
                initialFormatSlug={initialFormatSlug}
                sources={sources}
                initialSourceSlug={initialSourceSlug}
                allFormats={allFormats}
                supportedFormatSlugs={supportedFormatSlugs}
              />
            </Suspense>
          </div>
          {isAuthenticated ? (
            <>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="hidden lg:inline-flex h-9 items-center rounded-card border border-brand-purple/50 bg-brand-purple/10 px-3 text-sm font-semibold text-ink hover:border-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Admin
                </Link>
              )}
              {/* Accent icon shortcut to My Beacon, at every width. */}
              <Link
                href="/my-beacon"
                aria-label="Go to your My Beacon dashboard"
                className="inline-flex h-11 w-11 aspect-square shrink-0 items-center justify-center rounded-card bg-beacon text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <UserIcon />
              </Link>
              <form action="/auth/signout" method="post" className="hidden lg:block">
                <button
                  type="submit"
                  className="inline-flex h-9 items-center rounded-card border border-line bg-surface px-3 text-sm font-medium hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="hidden lg:inline-flex h-9 items-center rounded-card bg-beacon px-3 text-sm font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </HeaderShell>
  );
}

/** Holds the drawer trigger's box while its toggles resolve. */
function NavTriggerSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-11 w-11 shrink-0 rounded-card border border-line bg-base/60 lg:hidden"
    />
  );
}

function TogglePillSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="inline-flex h-9 w-32 items-center rounded-card border border-line bg-surface"
    />
  );
}

/* Flat single-color user glyph used by the desktop + mobile My Beacon
   shortcuts. fill="currentColor" so it inherits the button's text color. */
function UserIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      focusable="false"
      aria-hidden="true"
    >
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.31 0-8 1.67-8 5v1h16v-1c0-3.33-4.69-5-8-5Z" />
    </svg>
  );
}
