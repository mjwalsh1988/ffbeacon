import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import {
  ModerationManager,
  type IngestedPost,
  type ModerationItem,
  type TeamOption,
} from "@/components/admin/beacon-brief/moderation-manager";

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
  const [{ data }, { data: teamRows }] = await Promise.all([
    admin
      .from("beacon_brief_moderation")
      .select(
        "id, created_at, type, raw_name, candidates, article_id, detail, articles(title, slug), news_ingestions(text, author_handle, external_url, media, quoted, retweeted)",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("nfl_teams").select("id, abbreviation, name").order("name"),
  ]);

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
      description="Three kinds of review land here, and nothing is auto-applied. Deleted source posts wait for you to retract or keep the article. Player and team names the curator could not confidently match wait for you to pick the right one (or dismiss) so news shows on the correct profile. Tasks that failed after every retry wait for you to retry them or skip them."
    >
      <ModerationManager items={items} teams={teams} />
    </BeaconBriefPageShell>
  );
}
