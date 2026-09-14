"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { validateSiteLayout } from "@/lib/site-layout/parse";
import {
  SITE_LAYOUT_CACHE_TAG,
  saveSiteLayout,
  type SaveSiteLayoutResult,
} from "@/lib/site-layout/settings";

const ADMIN_PATH = "/admin/site-layout";

/**
 * Persist the site layout.
 *
 * Admin-only and validated server-side. requireAdmin runs first and is the real
 * boundary here: a server action POST does not pass through the admin layout's
 * gate. The payload is never trusted: it has to pass the strict schema, where
 * every list holds every tool or section exactly once and every tag, highlight
 * and width is one the site knows how to draw, before it is written with the
 * service-role client.
 *
 * `baseUpdatedAt` is the version the form was drawn from; the write is refused
 * if the row has been saved since (see saveSiteLayout).
 *
 * revalidateTag drops the cached row on every instance and marks every
 * prerendered page that read it for regeneration; revalidatePath("/", "layout")
 * clears the client router cache for every route, because the menu and footer
 * are on all of them.
 */
export async function saveSiteLayoutAction(
  raw: unknown,
  baseUpdatedAt: unknown,
): Promise<SaveSiteLayoutResult> {
  const { userId } = await requireAdmin(ADMIN_PATH);

  const validated = validateSiteLayout(raw);
  if (!validated.ok) return validated;

  // A timestamp string or nothing. Anything else is a hand-made request.
  if (
    baseUpdatedAt !== null &&
    (typeof baseUpdatedAt !== "string" ||
      baseUpdatedAt.length > 64 ||
      Number.isNaN(Date.parse(baseUpdatedAt)))
  ) {
    return { ok: false, error: "The page is out of date. Reload it and try again." };
  }

  const result = await saveSiteLayout(
    createAdminClient(),
    validated.settings,
    userId,
    baseUpdatedAt,
  );
  if (!result.ok) return result;

  revalidateTag(SITE_LAYOUT_CACHE_TAG);
  revalidatePath("/", "layout");
  return result;
}
