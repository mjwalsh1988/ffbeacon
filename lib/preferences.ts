import { cache } from "react";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readSourceSlug, getAvailableSources, pickDefaultSource } from "@/lib/source";
import { DEFAULT_FORMAT_SLUG } from "@/lib/site";

// Shared, request-scoped fetch of (user, user_preferences). Both resolvers
// below used to issue their own auth.getUser() + user_preferences SELECT,
// which doubled the request count on every page. With React.cache the
// resolvers share a single fetch.
const getUserPreferences = cache(
  async (supabase: SupabaseClient<Database>): Promise<{
    userId: string | null;
    defaultSourceSlug: string | null;
    defaultFormatConfigId: string | null;
  }> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { userId: null, defaultSourceSlug: null, defaultFormatConfigId: null };
    }
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("default_source_slug, default_format_config_id")
      .eq("user_id", user.id)
      .maybeSingle();
    return {
      userId: user.id,
      defaultSourceSlug: prefs?.default_source_slug ?? null,
      defaultFormatConfigId: prefs?.default_format_config_id ?? null,
    };
  },
);

export const SOURCE_COOKIE = "ffbeacon.source";
export const FORMAT_COOKIE = "ffbeacon.format";
export const PREFERENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const PREFERENCE_COOKIE_OPTIONS = {
  path: "/" as const,
  maxAge: PREFERENCE_COOKIE_MAX_AGE,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  httpOnly: false,
};

export const VALID_PREFERENCE_SLUG = /^[a-z0-9-]{1,64}$/;
const VALID_SLUG = VALID_PREFERENCE_SLUG;

export async function readCookieSlug(name: string): Promise<string | null> {
  const store = await cookies();
  const value = store.get(name)?.value;
  if (!value || !VALID_SLUG.test(value)) return null;
  return value;
}

export type ResolvedPreference = {
  slug: string;
  origin: "url" | "db" | "cookie" | "default";
  transient: boolean;
};

export async function resolveSourceSlug(
  supabase: SupabaseClient<Database>,
  searchParamSource: string | string[] | undefined,
): Promise<ResolvedPreference | { slug: null; origin: "default"; transient: false }> {
  const fromUrl = readSourceSlug(searchParamSource);
  if (fromUrl) return { slug: fromUrl, origin: "url", transient: true };

  const { defaultSourceSlug } = await getUserPreferences(supabase);
  if (defaultSourceSlug) {
    return { slug: defaultSourceSlug, origin: "db", transient: false };
  }

  const fromCookie = await readCookieSlug(SOURCE_COOKIE);
  if (fromCookie) return { slug: fromCookie, origin: "cookie", transient: false };

  const sources = await getAvailableSources(supabase);
  // The DB-backed site-wide default (source_registry.is_default), admin-editable
  // on /admin/beacon/sources. This is the only place new visitors with no
  // URL/DB/cookie signal land, so it controls the first-impression data shown
  // across the site. Falls back to the first active source in display order if
  // no default is flagged.
  const def = pickDefaultSource(sources);
  if (!def) return { slug: null, origin: "default", transient: false };
  return { slug: def, origin: "default", transient: false };
}

export async function resolveFormatSlug(
  supabase: SupabaseClient<Database>,
  searchParamFormat: string | string[] | undefined,
): Promise<ResolvedPreference> {
  const candidate = Array.isArray(searchParamFormat)
    ? searchParamFormat[0]
    : searchParamFormat;
  if (candidate && VALID_SLUG.test(candidate)) {
    return { slug: candidate, origin: "url", transient: true };
  }

  const { defaultFormatConfigId } = await getUserPreferences(supabase);
  if (defaultFormatConfigId) {
    const { data: format } = await supabase
      .from("format_configs")
      .select("slug")
      .eq("id", defaultFormatConfigId)
      .maybeSingle();
    if (format?.slug) {
      return { slug: format.slug, origin: "db", transient: false };
    }
  }

  const fromCookie = await readCookieSlug(FORMAT_COOKIE);
  if (fromCookie) return { slug: fromCookie, origin: "cookie", transient: false };

  return { slug: DEFAULT_FORMAT_SLUG, origin: "default", transient: false };
}
