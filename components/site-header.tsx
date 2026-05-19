import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PRIMARY_NAV, DEFAULT_FORMAT_SLUG, DEFAULT_SOURCE_SLUG } from "@/lib/site";
import {
  readCookieSlug,
  SOURCE_COOKIE,
  FORMAT_COOKIE,
} from "@/lib/preferences";
import type { FormatLike } from "@/lib/format-fallback";
import { getActiveFormats, getAvailableSources } from "@/lib/source";
import { BeaconMark } from "@/components/beacon-mark";
import { FormatToggle, type FormatOption } from "@/components/format-toggle";
import { SourceToggle, type SourceOption } from "@/components/source-toggle";
import { MobileMenu } from "@/components/mobile-menu";
import { HeaderNavLink } from "@/components/header-nav-link";
import {
  InfoTooltip,
  SOURCE_INFO_TOOLTIP,
  FORMAT_INFO_TOOLTIP,
} from "@/components/info-tooltip";

async function loadHeaderData(): Promise<{
  formats: FormatOption[];
  allFormats: FormatLike[];
  sources: SourceOption[];
  isAuthenticated: boolean;
  preferredFormatSlug: string | null;
  preferredSourceSlug: string | null;
}> {
  try {
    const supabase = await createClient();
    // Cached helpers — page-level callers share these Promises with us.
    const [formats, sources, { data: userData }] = await Promise.all([
      getActiveFormats(supabase),
      getAvailableSources(supabase),
      supabase.auth.getUser(),
    ]);

    let preferredFormatSlug: string | null = null;
    let preferredSourceSlug: string | null = null;
    if (userData?.user) {
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("default_format_config_id, default_source_slug")
        .eq("user_id", userData.user.id)
        .maybeSingle();
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
      preferredFormatSlug,
      preferredSourceSlug,
    };
  } catch {
    return {
      formats: [],
      allFormats: [],
      sources: [],
      isAuthenticated: false,
      preferredFormatSlug: null,
      preferredSourceSlug: null,
    };
  }
}

export async function SiteHeader() {
  const {
    formats,
    allFormats,
    sources,
    isAuthenticated,
    preferredFormatSlug,
    preferredSourceSlug,
  } = await loadHeaderData();
  const initialFormatSlug = preferredFormatSlug ?? DEFAULT_FORMAT_SLUG;
  // Mirror lib/preferences.ts → resolveSourceSlug: prefer the
  // explicitly-configured DEFAULT_SOURCE_SLUG (KTC) over the registry's
  // priority-ordered first entry, so new visitors with no preference
  // land on KTC in the header dropdown.
  const initialSourceSlug =
    preferredSourceSlug ??
    sources.find((s) => s.slug === DEFAULT_SOURCE_SLUG)?.slug ??
    sources[0]?.slug ??
    null;
  const fallbackFormats: FormatOption[] = formats.length
    ? formats
    : [
        { id: "fallback", slug: DEFAULT_FORMAT_SLUG, display_name: "Redraft PPR", is_default: true },
      ];

  // What does the resolved source support? Used to gate the Format dropdown.
  const activeSource = sources.find((s) => s.slug === initialSourceSlug) ?? null;
  const supportedFormatSlugs = activeSource?.supported_format_slugs ?? null;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-base/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center text-lg" aria-label="FF Beacon home">
          <BeaconMark />
        </Link>
        <nav aria-label="Primary" className="ml-6 hidden flex-1 items-center gap-1 md:flex">
          {PRIMARY_NAV.map((item) => (
            <HeaderNavLink key={item.href} href={item.href}>
              {item.label}
            </HeaderNavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {sources.length > 0 && (
            <div className="hidden items-center gap-1 md:flex">
              <InfoTooltip
                content={SOURCE_INFO_TOOLTIP}
                placement="below"
                align="start"
              />
              <Suspense fallback={<TogglePillSkeleton />}>
                <SourceToggle
                  options={sources}
                  initialSlug={initialSourceSlug}
                  currentFormatSlug={initialFormatSlug}
                  allFormats={allFormats}
                />
              </Suspense>
            </div>
          )}
          <div className="hidden items-center gap-1 md:flex">
            <InfoTooltip
              content={FORMAT_INFO_TOOLTIP}
              placement="below"
              align="start"
            />
            <Suspense fallback={<TogglePillSkeleton />}>
              <FormatToggle
                options={fallbackFormats}
                initialSlug={initialFormatSlug}
                supportedFormatSlugs={supportedFormatSlugs}
              />
            </Suspense>
          </div>
          {isAuthenticated ? (
            <form action="/auth/signout" method="post" className="hidden md:block">
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-card border border-line bg-surface px-3 text-sm font-medium hover:border-line-accent"
              >
                Sign out
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="hidden md:inline-flex h-9 items-center rounded-card bg-beacon px-3 text-sm font-semibold text-black"
            >
              Sign in
            </Link>
          )}
          <Suspense fallback={null}>
            <MobileMenu
              formats={fallbackFormats}
              initialFormatSlug={initialFormatSlug}
              sources={sources}
              initialSourceSlug={initialSourceSlug}
              isAuthenticated={isAuthenticated}
              allFormats={allFormats}
              supportedFormatSlugs={supportedFormatSlugs}
            />
          </Suspense>
        </div>
      </div>
    </header>
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
