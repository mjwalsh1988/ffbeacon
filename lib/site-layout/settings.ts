import "server-only";

/**
 * Load and persist the admin-edited site layout (menu order, tools page order,
 * homepage tool cards). The shapes and defaults are in `default-settings.ts`;
 * parsing and validation are in `parse.ts`.
 *
 * One jsonb row (id = 'global') in site_layout_settings, service-role only, the
 * same shape as would_you_rather_settings.
 *
 * READ ON EVERY PAGE, so the read is cheap by construction. The navigation rail,
 * the mobile drawer and the footer all need it in the same render, and React's
 * `cache` makes that one call. Across requests the row lives in Next's data
 * cache, tagged SITE_LAYOUT_CACHE_TAG, and the admin save calls revalidateTag on
 * it. That tag reaches every server instance at once AND every prerendered page
 * whose render read the row, which matters here: the Brief articles and the
 * rankings boards are prerendered, so the menu and footer are baked into their
 * HTML.
 *
 * An in-process memo (lib/memo-ttl.ts, what the other settings rows use) is the
 * wrong tool for exactly that reason. A save busts only the instance that took
 * it, so a prerendered page regenerated on another instance could bake the old
 * order into its HTML and keep it until that page next revalidated.
 *
 * The five minute revalidate is only a backstop for a row changed outside the
 * admin form, say by hand in SQL.
 *
 * A failed read falls back to the defaults rather than throwing, because a menu
 * must render on every page. The failure is thrown INSIDE the cached function
 * and caught outside it, so a database blip is never itself cached: the next
 * request tries again instead of serving the fallback for five minutes.
 */

import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_SITE_LAYOUT, type SiteLayoutSettings } from "./default-settings";
import { mergeSiteLayout } from "./parse";

type Client = SupabaseClient<Database>;

export const SITE_LAYOUT_SETTINGS_ID = "global";

/** The data cache tag. The admin save revalidates it. */
export const SITE_LAYOUT_CACHE_TAG = "site-layout";

/**
 * What the admin page found in the table.
 *
 * `error` is kept apart from `missing` on purpose. A form drawn from the
 * defaults after a failed read looks exactly like a real form, and saving it
 * would overwrite the stored layout with the defaults. Only the public read
 * path, which must render something, is allowed to treat the two alike.
 */
export type StoredSiteLayout =
  | {
      status: "stored";
      settings: SiteLayoutSettings;
      updatedAt: string;
      /** Null on the row migration 0282 seeded, until somebody saves. */
      updatedBy: string | null;
    }
  | { status: "missing"; settings: SiteLayoutSettings }
  | { status: "error" };

/**
 * Read the stored row straight from the database, with no cache. The admin page
 * uses this, because the form it draws is what the next save writes back, and
 * a form drawn from a stale copy would quietly undo a save made seconds earlier.
 */
export async function readSiteLayout(supabase: Client): Promise<StoredSiteLayout> {
  try {
    const { data, error } = await supabase
      .from("site_layout_settings")
      .select("settings, updated_at, updated_by")
      .eq("id", SITE_LAYOUT_SETTINGS_ID)
      .maybeSingle();
    if (error) return { status: "error" };
    if (!data) return { status: "missing", settings: DEFAULT_SITE_LAYOUT };
    return {
      status: "stored",
      settings: mergeSiteLayout(data.settings),
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
    };
  } catch {
    return { status: "error" };
  }
}

/**
 * The cached half. Throws on a failed read so the failure is not cached; a row
 * that genuinely does not exist is a real answer (the defaults) and is cached.
 */
async function fetchStoredLayout(): Promise<SiteLayoutSettings> {
  const { data, error } = await createAdminClient()
    .from("site_layout_settings")
    .select("settings")
    .eq("id", SITE_LAYOUT_SETTINGS_ID)
    .maybeSingle();
  if (error) throw new Error(`site_layout_settings read failed: ${error.message}`);
  return data?.settings ? mergeSiteLayout(data.settings) : DEFAULT_SITE_LAYOUT;
}

/** The layout every public page renders with. Cached; never throws. */
export const loadSiteLayout = cache(async (): Promise<SiteLayoutSettings> => {
  try {
    return await unstable_cache(fetchStoredLayout, ["site-layout"], {
      revalidate: 300,
      tags: [SITE_LAYOUT_CACHE_TAG],
    })();
  } catch {
    return DEFAULT_SITE_LAYOUT;
  }
});

export type SaveSiteLayoutResult =
  | { ok: true; updatedAt: string }
  | { ok: false; error: string };

const CONFLICT_MESSAGE =
  "This layout was saved somewhere else after you opened this page, so nothing was saved here. Reload the page to see that version, then make your changes again.";

const FAILED_MESSAGE =
  "Could not save the layout. Nothing changed on the site. Try again in a moment.";

/**
 * Persist a validated layout. Admin server actions only.
 *
 * CONDITIONAL on the version the form was drawn from. `baseUpdatedAt` is the
 * row's `updated_at` when the admin page loaded (null when there was no row),
 * and the write only lands if the row still carries it. Without that, the
 * second of two open tabs silently undoes the first tab's save, which is the
 * very thing the admin page's uncached read exists to prevent.
 *
 * The database's own error is logged here and not returned: it names tables
 * and constraints, which is nothing an admin can act on from the form.
 */
export async function saveSiteLayout(
  supabase: Client,
  settings: SiteLayoutSettings,
  updatedBy: string | null,
  baseUpdatedAt: string | null,
): Promise<SaveSiteLayoutResult> {
  const now = new Date().toISOString();
  const row = {
    settings: settings as unknown as Json,
    updated_at: now,
    updated_by: updatedBy,
  };

  if (baseUpdatedAt === null) {
    // There was no row when the form loaded. Insert, and a row that has
    // appeared since is a conflict rather than something to overwrite.
    const { error } = await supabase
      .from("site_layout_settings")
      .insert({ id: SITE_LAYOUT_SETTINGS_ID, ...row });
    if (error) {
      if (error.code === "23505") return { ok: false, error: CONFLICT_MESSAGE };
      console.error("[site-layout] save failed:", error.message);
      return { ok: false, error: FAILED_MESSAGE };
    }
    return { ok: true, updatedAt: now };
  }

  const { data, error } = await supabase
    .from("site_layout_settings")
    .update(row)
    .eq("id", SITE_LAYOUT_SETTINGS_ID)
    .eq("updated_at", baseUpdatedAt)
    .select("updated_at");
  if (error) {
    console.error("[site-layout] save failed:", error.message);
    return { ok: false, error: FAILED_MESSAGE };
  }
  const saved = data?.[0];
  if (!saved) return { ok: false, error: CONFLICT_MESSAGE };
  return { ok: true, updatedAt: saved.updated_at };
}
