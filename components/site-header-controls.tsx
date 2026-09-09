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
import { AppMobileNav } from "@/components/app-shell/app-mobile-nav";
import { buildNavTree } from "@/lib/nav-tree";
import { getNavViewer } from "@/lib/nav-viewer";
import { BeamLauncher } from "@/components/beam/beam-launcher";
import { BookmarksLauncherSlot } from "@/components/bookmarks/bookmark-slots";
import { isHandheldRequest } from "@/lib/device";
import { DonateLauncher } from "@/components/donate/donate-launcher";
import { stripeConfigured } from "@/lib/donate/stripe";

/**
 * Everything in the header that needs a database or auth read: the format and
 * source toggles, search, Ask BEAM, donate, and the signed-in/signed-out
 * account controls (including the mobile nav trigger, since its drawer needs
 * the same nav tree and viewer state). Split out of components/site-header.tsx
 * (PERF-T021) so the brand cell and rail toggle can paint before any of this
 * resolves: this component is rendered inside a Suspense boundary, and the
 * slowest read here is the per-reader auth round trip in getNavViewer, which
 * cannot be memoised the way the format/source/settings reads can.
 */
async function loadHeaderData(): Promise<{
  formats: FormatOption[];
  allFormats: FormatLike[];
  sources: SourceOption[];
  isAuthenticated: boolean;
  isAdmin: boolean;
  preferredFormatSlug: string | null;
  preferredSourceSlug: string | null;
  defaultSourceSlug: string | null;
  /**
   * Null on a handheld, where Ask BEAM is not offered at all, so its settings
   * row is never read. Anything else would be a database round trip for a
   * control that does not render.
   */
  beamStarters: string[] | null;
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
    // Ask BEAM is a desktop feature (see lib/device.ts). On a handheld its
    // settings row is not read at all: the launcher is not rendered there, so
    // the read would buy nothing.
    const isHandheld = await isHandheldRequest();
    const [formats, sources, viewer, beamSettings] = await Promise.all([
      getActiveFormats(supabase),
      getAvailableSources(supabase),
      getNavViewer(),
      isHandheld ? Promise.resolve(null) : loadBeamSettings(createAdminClient()),
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
      beamStarters: beamSettings
        ? starterExamples(beamSettings.capabilities.disabled, 4)
        : null,
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

export async function SiteHeaderControls() {
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
    <>
      {/* Rail width on desktop, navigation drawer on a phone. Only ever one
          of the two is rendered at a given width. */}
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
        {/* Ask BEAM: DESKTOP ONLY. It used to sit here at every width, which
            put three product controls plus an account button into a phone's
            header and left no room for anything else. On a handheld the slot
            belongs to the bookmarks trigger below, which is the only way into
            the bookmark list when there is no bar.

            Two gates, and they are not redundant. `isHandheld` is a user-agent
            guess and decides whether the SETTINGS ROW IS READ at all; the
            `lg` class decides what is PAINTED, so a narrow desktop window
            loses the launcher too without anyone having to guess about it. */}
        {beamStarters !== null && (
          <span className="hidden lg:inline-flex">
            <BeamLauncher starters={beamStarters} />
          </span>
        )}
        {/* Your bookmarks. Below lg it is the only route to them; on a device
            the server read as a handheld it shows at every width, because no
            bar was loaded for it to fall back on. Renders nothing at all when
            signed out. */}
        <Suspense fallback={null}>
          <BookmarksLauncherSlot />
        </Suspense>
        {/* Donate: sits to the right of the two product controls, at every
            breakpoint. Last in the cluster on purpose, because it is the one
            control here that is not part of using the site. */}
        <DonateLauncher cardEnabled={stripeConfigured()} />
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
              className="relative inline-flex h-9 w-9 aspect-square shrink-0 items-center justify-center rounded-card bg-beacon text-black before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
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
    </>
  );
}

/** Holds the drawer trigger's box while its toggles resolve. Dead weight today
 * (AppMobileNav is a synchronous client component once SiteHeaderControls has
 * its data, so it never actually suspends here), kept because removing it is
 * out of scope for this change and it costs nothing while unused. */
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

/**
 * The Suspense fallback for SiteHeaderControls (PERF-T021). Every box here
 * mirrors the real control it stands in for: same height, same responsive
 * hidden/visible classes, so the header's fixed 4.5rem height
 * (components/header-shell.tsx) never moves and the row's horizontal layout
 * is as close to final as it can be without knowing the one thing this
 * boundary exists to defer, whether the reader is signed in.
 *
 * `likelySignedIn` is a cookie HINT, read in components/site-header.tsx from
 * whether the request carries a cookie shaped like this project's Supabase
 * auth token. It is never a verified auth state (see the comment there), and
 * it decides only which placeholder shape this fallback reserves: the
 * signed-in shape (My Beacon icon plus the Sign out button) when a token
 * looks present, the signed-out shape (nothing below lg, a Sign in box at
 * lg and up) when it does not. Before this flag existed the fallback always
 * reserved the signed-in shape, so every signed-out visitor, which is most
 * visitors, saw a phantom account control that vanished the moment the real
 * controls resolved.
 *
 * The format, source and settings reads this boundary waits on are
 * TTL-memoised now (PERF-T020) and resolve near-instantly for everyone, so
 * the one read left that can make this boundary visibly slow is the
 * per-reader auth round trip inside getNavViewer. A signed-out reader's
 * fallback swap happens too fast to see either way; sizing it to the correct
 * shape instead of the wrong one costs nothing.
 *
 * Every box here is a plain aria-hidden div rather than a disabled button, so
 * nothing here is a tab stop. A keyboard reader who tabs into the header
 * before the real controls resolve moves straight past this whole area (there
 * is nothing to land on) to whatever comes after the header, exactly as if
 * the header were shorter for a moment. There is no disabled control that
 * silently becomes enabled underneath a resting focus, because focus can
 * never rest here in the first place.
 */
export function HeaderControlsFallback({
  likelySignedIn,
}: {
  likelySignedIn: boolean;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        className="h-11 w-11 shrink-0 rounded-card border border-line bg-base/60 lg:hidden"
      />
      <div className="ml-auto flex items-center gap-2" aria-busy="true">
        {/* Search trigger, every breakpoint. */}
        <div
          aria-hidden="true"
          className="h-9 w-9 rounded-card border border-line bg-surface"
        />
        {/* Ask BEAM trigger, desktop only now. */}
        <div
          aria-hidden="true"
          className="hidden lg:block h-9 w-9 rounded-card border border-brand-purple/50 bg-brand-purple/10"
        />
        {/* The bookmarks trigger stands where BEAM used to below lg, and only
            for a reader who looks signed in. A signed-out visitor never gets
            one, so reserving a box for them would be the phantom control this
            fallback exists to avoid. */}
        {likelySignedIn && (
          <div
            aria-hidden="true"
            className="h-9 w-9 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 lg:hidden"
          />
        )}
        {/* Donate trigger: icon-only below sm, icon plus label at sm+. */}
        <div
          aria-hidden="true"
          className="h-9 w-9 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 sm:w-24"
        />
        {/* Source + format popover trigger, desktop only. */}
        <div
          aria-hidden="true"
          className="hidden md:block h-9 w-32 rounded-card border border-line bg-surface"
        />
        {/* The account area. An admin's "Admin" link (hidden lg:inline-flex,
            rendered only when isAdmin) has no placeholder in either shape
            below: a cookie can say a reader is probably signed in, but it
            says nothing about whether they are an admin, so there is no
            signal here to reserve space from. An admin whose Admin link
            arrives at lg and up still shifts the icon and Sign out button
            (or the Sign in box) rightward by that link's width. That residual
            shift is accepted rather than guessed at. */}
        {likelySignedIn ? (
          <>
            {/* My Beacon icon shortcut, every breakpoint. */}
            <div
              aria-hidden="true"
              className="h-9 w-9 rounded-card bg-beacon/40"
            />
            {/* Sign out button, desktop only. */}
            <div
              aria-hidden="true"
              className="hidden lg:block h-9 w-20 rounded-card border border-line bg-surface"
            />
          </>
        ) : (
          // The real signed-out state renders only a Sign in link, itself
          // hidden below lg, at no other width. Matching that shape here
          // means a signed-out visitor never sees a My Beacon icon or a Sign
          // out box that then disappears.
          <div
            aria-hidden="true"
            className="hidden lg:block h-9 w-16 rounded-card bg-beacon/40"
          />
        )}
      </div>
    </>
  );
}
