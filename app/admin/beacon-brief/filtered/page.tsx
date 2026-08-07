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

/** Read one field out of the filter_detail jsonb the relevance gate writes. */
function detailField(detail: unknown, key: string): unknown {
  return detail && typeof detail === "object"
    ? (detail as Record<string, unknown>)[key]
    : undefined;
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

  const items: FilteredItem[] = (data ?? []).map((row) => {
    // Rows written before migration 0153 carry only the two original reasons, so
    // an unrecognized value falls back to the non-football label rather than
    // rendering an empty one.
    const reason: FilteredItem["reason"] =
      row.filter_reason === "keyword"
        ? "keyword"
        : row.filter_reason === "ai_low_relevance"
          ? "ai_low_relevance"
          : row.filter_reason === "volume_cap"
            ? "volume_cap"
            : "ai_non_football";
    const tier = detailField(row.filter_detail, "relevance_tier");
    const why = detailField(row.filter_detail, "reason");
    const capPlayer = detailField(row.filter_detail, "player_name");
    const capCount = detailField(row.filter_detail, "articles_in_24h");
    const capLimit = detailField(row.filter_detail, "cap");
    return {
      id: row.id,
      created_at: row.created_at,
      reason,
      matchedTerms: matchedTermsOf(row.filter_detail),
      suggestedTitle: suggestedTitleOf(row.ai_result),
      relevanceTier: typeof tier === "number" ? tier : null,
      relevanceReason:
        typeof why === "string" && why.trim() ? why.trim() : null,
      rejectedAtArticleStage:
        detailField(row.filter_detail, "stage") === "article",
      volumeCap:
        reason === "volume_cap"
          ? {
              playerName:
                typeof capPlayer === "string" && capPlayer.trim()
                  ? capPlayer.trim()
                  : "This player",
              count: typeof capCount === "number" ? capCount : 0,
              cap: typeof capLimit === "number" ? capLimit : 0,
            }
          : null,
      post: toIngestedPost(row),
    };
  });

  return (
    <BeaconBriefPageShell
      title="Filtered"
      description="Posts held back before they reached Discord or the article writer: a blocked keyword, another sport, or a fantasy relevance score below the threshold. Force a post through the pipeline (this bypasses every filter) or delete it from the system."
    >
      <FilteredManager items={items} />
    </BeaconBriefPageShell>
  );
}
