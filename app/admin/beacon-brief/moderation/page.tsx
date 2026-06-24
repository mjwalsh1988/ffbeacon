import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import {
  ModerationManager,
  type ModerationItem,
  type TeamOption,
} from "@/components/admin/beacon-brief/moderation-manager";

export const metadata: Metadata = { title: "Moderation" };
export const dynamic = "force-dynamic";

type Candidate = { id: string; label: string };

export default async function BeaconBriefModerationPage() {
  await requireAdmin("/admin/beacon-brief/moderation");
  const admin = createAdminClient();
  const [{ data }, { data: teamRows }] = await Promise.all([
    admin
      .from("beacon_brief_moderation")
      .select(
        "id, created_at, type, raw_name, candidates, article_id, detail, articles(title, slug)",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(500),
    admin.from("teams").select("id, abbreviation, name").order("name"),
  ]);

  const items: ModerationItem[] = (data ?? []).map((m) => {
    const art = (m as { articles?: { title?: string; slug?: string } | null })
      .articles;
    const articleTitle = art?.title ?? null;
    const articleSlug = art?.slug ?? null;

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
    };
  });

  const teams = (teamRows ?? []) as TeamOption[];

  return (
    <BeaconBriefPageShell
      title="Moderation"
      description="Two kinds of review land here, and nothing is auto-applied. Deleted source posts wait for you to retract or keep the article. Player and team names the curator could not confidently match wait for you to pick the right one (or dismiss) so news shows on the correct profile."
    >
      <ModerationManager items={items} teams={teams} />
    </BeaconBriefPageShell>
  );
}
