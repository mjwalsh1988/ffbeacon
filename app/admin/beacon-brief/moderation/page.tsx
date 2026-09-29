import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import {
  ModerationManager,
  type IngestedPost,
  type ModerationItem,
  type TeamOption,
} from "@/components/admin/beacon-brief/moderation-manager";
import { countRelayReviewQueue } from "@/lib/relays/review-queue";

export const metadata: Metadata = { title: "Moderation" };
export const dynamic = "force-dynamic";

type Candidate = { id: string; label: string };

type EmbeddedQuoted = {
  author_handle?: string | null;
  text?: string | null;
} | null;

type EmbeddedIngestion = {
  text?: string | null;
  author_handle?: string | null;
  external_url?: string | null;
  media?: unknown;
  quoted?: EmbeddedQuoted;
  retweeted?: EmbeddedQuoted;
} | null;

function toQuoted(q: EmbeddedQuoted): IngestedPost["quoted"] {
  if (!q || typeof q.text !== "string") return null;
  return {
    authorHandle: typeof q.author_handle === "string" ? q.author_handle : null,
    text: q.text,
  };
}

/** Shape the embedded news_ingestions row into the post-context the UI renders. */
function toIngestedPost(ing: EmbeddedIngestion): IngestedPost | null {
  if (!ing) return null;
  const media = Array.isArray(ing.media)
    ? (ing.media as Array<{ type?: unknown; url?: unknown }>)
        .filter((m) => m && typeof m.url === "string")
        .map((m) => ({
          type: typeof m.type === "string" ? m.type : "media",
          url: m.url as string,
        }))
    : [];
  return {
    authorHandle:
      typeof ing.author_handle === "string" ? ing.author_handle : null,
    text: typeof ing.text === "string" ? ing.text : "",
    externalUrl: typeof ing.external_url === "string" ? ing.external_url : null,
    media,
    quoted: toQuoted(ing.quoted ?? null),
    retweeted: toQuoted(ing.retweeted ?? null),
  };
}

export default async function BeaconBriefModerationPage() {
  await requireAdmin("/admin/beacon-brief/moderation");
  const admin = createAdminClient();
  // A Relay that failed grounding is reviewed on the Relays page, next to its
  // edit form, and every decision there closes its row. Listing it here too is
  // what made the owner decide each one twice, so this page counts them and
  // links across instead.
  const [{ data }, { data: teamRows }, relayReviewCount] = await Promise.all([
    admin
      .from("beacon_brief_moderation")
      .select(
        "id, created_at, type, raw_name, candidates, article_id, detail, articles(title, slug), news_ingestions(text, author_handle, external_url, media, quoted, retweeted)",
      )
      .eq("status", "pending")
      .or("type.neq.failed_task,detail->>job_type.is.null,detail->>job_type.neq.relay_grounding")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("nfl_teams").select("id, abbreviation, name").order("name"),
    countRelayReviewQueue(admin),
  ]);

  // A Brief review row names its article; the review page is keyed by the
  // brief_editions id, so look those up in one read.
  const briefArticleIds = (data ?? [])
    .filter((m) => (m.type === "brief_review" || m.type === "brief_correction") && typeof m.article_id === "string")
    .map((m) => m.article_id as string);
  const editionIdByArticle = new Map<string, string>();
  if (briefArticleIds.length > 0) {
    const { data: editionRows } = await admin
      .from("brief_editions")
      .select("id, article_id")
      .in("article_id", briefArticleIds.slice(0, 300));
    for (const e of editionRows ?? []) editionIdByArticle.set(e.article_id, e.id);
  }

  const items: ModerationItem[] = (data ?? []).map((m) => {
    const art = (m as { articles?: { title?: string; slug?: string } | null })
      .articles;
    const articleTitle = art?.title ?? null;
    const articleSlug = art?.slug ?? null;
    const post = toIngestedPost(
      (m as { news_ingestions?: EmbeddedIngestion }).news_ingestions ?? null,
    );

    if (m.type === "player_match" || m.type === "team_match") {
      const candidates = Array.isArray(m.candidates)
        ? (m.candidates as unknown as Candidate[]).filter(
            (c) => c && typeof c.id === "string" && typeof c.label === "string",
          )
        : [];
      return {
        type: m.type,
        id: m.id,
        created_at: m.created_at,
        rawName: m.raw_name ?? "(unknown)",
        candidates,
        articleTitle,
        articleSlug,
        articleReady: Boolean(m.article_id),
        post,
      };
    }

    if (m.type === "failed_task") {
      const detail = m.detail as {
        job_type?: string;
        error?: string;
        attempts?: number;
      } | null;
      return {
        type: "failed_task",
        id: m.id,
        created_at: m.created_at,
        jobType: detail?.job_type ?? "unknown",
        error: detail?.error ?? null,
        attempts: typeof detail?.attempts === "number" ? detail.attempts : null,
        articleTitle,
        articleSlug,
        post,
      };
    }

    if (m.type === "brief_review" || m.type === "brief_correction") {
      return {
        type: m.type,
        id: m.id,
        created_at: m.created_at,
        articleTitle,
        editionId: m.article_id ? (editionIdByArticle.get(m.article_id) ?? null) : null,
        post,
      };
    }

    const detail = m.detail as { source_external_id?: string } | null;
    return {
      type: "deletion",
      id: m.id,
      created_at: m.created_at,
      articleTitle,
      articleSlug,
      detail: detail?.source_external_id
        ? `source post ${detail.source_external_id}`
        : "",
      post,
    };
  });

  const teams = (teamRows ?? []) as TeamOption[];

  return (
    <BeaconBriefPageShell
      title="Moderation"
      description="Deleted source posts wait for you to retract or keep the Relay. Player and team names the curator could not confidently match wait for you to pick the right one (or dismiss) so news shows on the correct profile. Discord and deletion tasks that failed after every retry wait for you to retry or skip them. A Brief edition waiting for review is listed with a link to its page. Relays that failed the grounding check are reviewed on the Relays page."
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          {relayReviewCount === 0
            ? "No Relays are waiting for grounding review. "
            : `${relayReviewCount} ${relayReviewCount === 1 ? "Relay is" : "Relays are"} waiting for grounding review. `}
          <Link href="/admin/brief-desk/relays" className="inline-flex min-h-[44px] items-center font-semibold text-brand-cyan underline">
            Open the Relays review
          </Link>
        </p>
        <ModerationManager items={items} teams={teams} />
      </div>
    </BeaconBriefPageShell>
  );
}
