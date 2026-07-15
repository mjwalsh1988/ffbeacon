import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PRIMARY_NAV, DEFAULT_FORMAT_SLUG } from "@/lib/site";
import {
  readCookieSlug,
  SOURCE_COOKIE,
  FORMAT_COOKIE,
} from "@/lib/preferences";
import type { FormatLike } from "@/lib/format-fallback";
import { getActiveFormats, getAvailableSources, pickDefaultSource } from "@/lib/source";
import { BeaconMark } from "@/components/beacon-mark";
import { type FormatOption } from "@/components/format-toggle";
import { type SourceOption } from "@/components/source-toggle";
import { MobileMenu } from "@/components/mobile-menu";
import { SiteSearch } from "@/components/site-search";
import { PreferencesMenu } from "@/components/preferences-menu";
import { HeaderNavLink } from "@/components/header-nav-link";
import { NavDropdown } from "@/components/nav-dropdown";
import { HeaderShell } from "@/components/header-shell";

async function loadHeaderData(): Promise<{
  formats: FormatOption[];
  allFormats: FormatLike[];
  sources: SourceOption[];
  isAuthenticated: boolean;
  isAdmin: boolean;
  preferredFormatSlug: string | null;
  preferredSourceSlug: string | null;
  defaultSourceSlug: string | null;
}> {
  try {
    const supabase = await createClient();
    // Cached helpers: page-level callers share these Promises with us.
    const [formats, sources, { data: userData }] = await Promise.all([
      getActiveFormats(supabase),
      getAvailableSources(supabase),
      supabase.auth.getUser(),
    ]);

    let preferredFormatSlug: string | null = null;
    let preferredSourceSlug: string | null = null;
    let isAdmin = false;
    if (userData?.user) {
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("default_format_config_id, default_source_slug, is_admin")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      isAdmin = Boolean(prefs?.is_admin);
      if (prefs?.default_format_config_id) {
        const match = formats.find((f) => f.id === prefs.default_format_config_id);
        if (match) preferredFormatSlug = match.slug;
      }
      if (prefs?.default_source_slug) {
        const match = sources.find((s) => s.slug === prefs.default_source_slug);
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
      isAuthenticated: !!userData?.user,
      isAdmin,
      preferredFormatSlug,
      preferredSourceSlug,
      defaultSourceSlug: pickDefaultSource(sources),
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
  const activeSource = sources.find((s) => s.slug === initialSourceSlug) ?? null;
  const supportedFormatSlugs = activeSource?.supported_format_slugs ?? null;

  return (
    <HeaderShell>
      <Link href="/" className="flex shrink-0 items-center text-lg" aria-label="FF Beacon home">
        <BeaconMark />
      </Link>
      <nav
        aria-label="Primary"
        className="hidden flex-1 items-center justify-center gap-1 md:flex"
      >
          {PRIMARY_NAV.map((item) =>
            item.children && item.children.length > 0 ? (
              <NavDropdown
                key={item.href}
                label={item.label}
                href={item.href}
                items={item.children}
                overviewLabel={item.overviewLabel}
                overviewDescription={item.overviewDescription}
              />
            ) : (
              <HeaderNavLink key={item.href} href={item.href}>
                {item.label}
              </HeaderNavLink>
            ),
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {/* Site search: icon trigger visible on every breakpoint, opens the
              accessible search palette (players, articles, tools). */}
          <SiteSearch />
          {/* Desktop: source + format toggles are tucked into a single popover
              to save header space. Mobile keeps them inline in the slide-out
              menu below. */}
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
              {/* Desktop: Admin link, only for admins. Sits before the My
                  Beacon shortcut so the operational entry point is grouped
                  with the other authenticated actions. */}
              {isAdmin && (
                <Link
                  href="/admin"
                  className="hidden md:inline-flex h-9 items-center rounded-card border border-brand-purple/50 bg-brand-purple/10 px-3 text-sm font-semibold text-ink hover:border-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Admin
                </Link>
              )}
              {/* Desktop: accent icon shortcut to My Beacon. Sits to the
                  left of Sign out so the primary user-space action stays
                  visually distinct from the destructive one. */}
              <Link
                href="/my-beacon"
                aria-label="Go to your My Beacon dashboard"
                className="hidden md:inline-flex h-9 w-9 aspect-square shrink-0 items-center justify-center rounded-card bg-beacon text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <UserIcon />
              </Link>
              <form action="/auth/signout" method="post" className="hidden md:block">
                <button
                  type="submit"
                  className="inline-flex h-9 items-center rounded-card border border-line bg-surface px-3 text-sm font-medium hover:border-line-accent"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="hidden md:inline-flex h-9 items-center rounded-card bg-beacon px-3 text-sm font-semibold text-black"
            >
              Sign in
            </Link>
          )}
          {/* Mobile: same accent My Beacon shortcut, sits to the left of
              the hamburger so authenticated users can jump to their space
              in one tap. Only rendered when signed in. */}
          {isAuthenticated && (
            <Link
              href="/my-beacon"
              aria-label="Go to your My Beacon dashboard"
              className="md:hidden inline-flex h-9 w-9 aspect-square shrink-0 items-center justify-center rounded-card bg-beacon text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <UserIcon />
            </Link>
          )}
          <Suspense fallback={null}>
            <MobileMenu
              formats={fallbackFormats}
              initialFormatSlug={initialFormatSlug}
              sources={sources}
              initialSourceSlug={initialSourceSlug}
              isAuthenticated={isAuthenticated}
              isAdmin={isAdmin}
              allFormats={allFormats}
              supportedFormatSlugs={supportedFormatSlugs}
            />
          </Suspense>
        </div>
    </HeaderShell>
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
