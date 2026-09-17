/**
 * Where an archived per-post Beacon Brief article slug now points.
 *
 * app/brief/[slug]/page.tsx calls this when no published article matches the
 * slug, and issues a permanent redirect to the Relay permalink. The table is
 * written once by scripts/archive-legacy-articles.ts and is service-role only,
 * so the lookup takes the admin client and reads two columns.
 *
 * The OUTPUT is checked against the same slug shape as the input. The caller
 * interpolates it into a redirect target, and a stored value beginning "//"
 * would make that an off-site redirect from a URL search engines have already
 * indexed. Nothing can write such a value today, which is exactly why the guard
 * belongs here rather than in a comment about who writes the table.
 *
 * THE TARGET MUST BE PUBLISHED. Forty-two of the archive's rows point at a
 * Relay the grounding check hid, and the permalink answers 404 for a hidden
 * Relay, so those article URLs answered 308 to a 404: worse for a reader and
 * for a crawler than the 404 alone (next.config.ts says the same about its
 * own redirects). The check is at read time rather than in the archive
 * script on purpose: when the owner publishes a hidden Relay from the Relays
 * manager, the redirect comes alive by itself, and a row skipped at write
 * time would have left the old URL a 404 for good.
 */
const SLUG = /^[a-z0-9-]{1,120}$/;

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export async function lookupLegacyArticleRedirect(
  admin: SupabaseClient<Database>,
  articleSlug: string,
): Promise<string | null> {
  if (!SLUG.test(articleSlug)) return null;
  const { data } = await admin
    .from("legacy_article_redirects")
    .select("relay_slug")
    .eq("article_slug", articleSlug)
    .maybeSingle();
  const target = data?.relay_slug ?? null;
  if (!target || !SLUG.test(target)) return null;
  const { data: relay } = await admin.from("relays").select("status").eq("slug", target).maybeSingle();
  return relay?.status === "published" ? target : null;
}
