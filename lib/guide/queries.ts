/**
 * Read helpers for the Signal Guide.
 *
 * `getPublishedGuideContent` powers the public panel: it returns a page's
 * published entries split into questions and terms, ordered for display. It
 * filters is_published explicitly (belt-and-suspenders alongside the RLS public
 * policy) so it returns the same result with either the anon or service-role
 * client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { GuideEntry, GuideEntryKind, GuidePage, GuidePageContent } from "./types";

type Client = SupabaseClient<Database>;

const PAGE_COLUMNS = "id, page_key, title, description, route_example, display_order";
const ENTRY_COLUMNS =
  "id, page_id, kind, heading, body, display_order, is_published";

function toEntry(r: {
  id: string;
  page_id: string;
  kind: string;
  heading: string;
  body: string;
  display_order: number;
  is_published: boolean;
}): GuideEntry {
  return {
    id: r.id,
    page_id: r.page_id,
    kind: r.kind as GuideEntryKind,
    heading: r.heading,
    body: r.body,
    display_order: r.display_order,
    is_published: r.is_published,
  };
}

/**
 * Fetch a page plus its published entries. Returns null when the key is unknown
 * or the page has zero published entries (the launcher uses null/empty to stay
 * hidden).
 */
export async function getPublishedGuideContent(
  client: Client,
  pageKey: string,
): Promise<GuidePageContent | null> {
  const { data: page } = await client
    .from("guide_pages")
    .select(PAGE_COLUMNS)
    .eq("page_key", pageKey)
    .maybeSingle();
  if (!page) return null;

  const { data: rows } = await client
    .from("guide_entries")
    .select(ENTRY_COLUMNS)
    .eq("page_id", page.id)
    .eq("is_published", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  const entries = (rows ?? []).map(toEntry);
  if (entries.length === 0) return null;

  return {
    page: page as GuidePage,
    questions: entries.filter((e) => e.kind === "question"),
    terms: entries.filter((e) => e.kind === "term"),
  };
}
