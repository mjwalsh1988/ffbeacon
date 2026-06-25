import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import {
  FilteredManager,
  type FilteredItem,
} from "@/components/admin/beacon-brief/filtered-manager";
import type { IngestedPost } from "@/components/admin/beacon-brief/moderation-manager";

export const metadata: Metadata = { title: "Filtered" };
export const dynamic = "force-dynamic";

type EmbeddedQuoted = {
  author_handle?: string | null;
  text?: string | null;
} | null;

/** Shape the stored ingestion columns into the post-context the UI renders. */
function toIngestedPost(row: {
  text?: string | null;
  author_handle?: string | null;
  external_url?: string | null;
  media?: unknown;
  quoted?: unknown;
  retweeted?: unknown;
}): IngestedPost | null {
  const media = Array.isArray(row.media)
    ? (row.media as Array<{ type?: unknown; url?: unknown }>)
        .filter((m) => m && typeof m.url === "string")
        .map((m) => ({
          type: typeof m.type === "string" ? m.type : "media",
          url: m.url as string,
        }))
    : [];
  const toQuoted = (raw: unknown): IngestedPost["quoted"] => {
    const q = raw as EmbeddedQuoted;
    return q && typeof q.text === "string"
      ? {
          authorHandle:
            typeof q.author_handle === "string" ? q.author_handle : null,
          text: q.text,
        }
      : null;
  };
  return {
    authorHandle:
      typeof row.author_handle === "string" ? row.author_handle : null,
    text: typeof row.text === "string" ? row.text : "",
    externalUrl: typeof row.external_url === "string" ? row.external_url : null,
    media,
    quoted: toQuoted(row.quoted),
    retweeted: toQuoted(row.retweeted),
  };
}

function matchedTermsOf(detail: unknown): string[] {
  if (detail && typeof detail === "object" && "matched_terms" in detail) {
    const terms = (detail as { matched_terms?: unknown }).matched_terms;
    if (Array.isArray(terms))
      return terms.filter((t): t is string => typeof t === "string");
  }
  return [];
}

function suggestedTitleOf(aiResult: unknown): string | null {
  if (
    aiResult &&
    typeof aiResult === "object" &&
    "suggested_title" in aiResult
  ) {
    const t = (aiResult as { suggested_title?: unknown }).suggested_title;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return null;
}

export default async function BeaconBriefFilteredPage() {
  await requireAdmin("/admin/beacon-brief/filtered");
  const admin = createAdminClient();
  const { data } = await admin
    .from("news_ingestions")
    .select(
      "id, created_at, filter_reason, filter_detail, ai_result, text, author_handle, external_url, media, quoted, retweeted",
    )
    .eq("status", "filtered")
    .order("created_at", { ascending: false })
    .limit(500);

  const items: FilteredItem[] = (data ?? []).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    reason: row.filter_reason === "keyword" ? "keyword" : "ai_non_football",
    matchedTerms: matchedTermsOf(row.filter_detail),
    suggestedTitle: suggestedTitleOf(row.ai_result),
    post: toIngestedPost(row),
  }));

  return (
    <BeaconBriefPageShell
      title="Filtered"
      description="Posts the non-football filter held back, by keyword match or by the AI classifier. Nothing here was posted to Discord or made into an article. Force a post through the pipeline (this bypasses both filters) or delete it from the system."
    >
      <FilteredManager items={items} />
    </BeaconBriefPageShell>
  );
}
