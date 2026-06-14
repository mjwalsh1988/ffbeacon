import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus } from "@/lib/beacon-admin";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";
import { RankingsReview, type ReviewRow } from "@/components/admin/rankings-review";

export const metadata: Metadata = { title: "Rankings & Values" };
export const dynamic = "force-dynamic";

const RANKINGS_CAP = 250;
const FLAGSHIP = "dynasty-ppr-sflex";

export default async function BeaconRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; position?: string }>;
}) {
  await requireAdmin("/admin/beacon/rankings");
  const admin = createAdminClient();
  const sp = await searchParams;

  const { data: ffRow } = await admin
    .from("source_registry").select("supported_format_slugs").eq("slug", "ffbeacon").single();
  const ffSlugs = ffRow?.supported_format_slugs ?? [];
  const { data: fmtRows } = await admin
    .from("format_configs").select("id, slug, display_order").order("display_order");
  const formats = (fmtRows ?? []).filter((f) => ffSlugs.includes(f.slug));
  const formatIdBySlug = new Map(formats.map((f) => [f.slug, f.id]));

  const currentFormat = sp.format && formatIdBySlug.has(sp.format) ? sp.format : FLAGSHIP;
  const currentPosition = (sp.position ?? "ALL").toUpperCase();
  const formatId = formatIdBySlug.get(currentFormat)!;

  const [review, { data: fmtStatus }, recompute] = await Promise.all([
    loadReview(admin, formatId, currentPosition),
    admin.from("beacon_format_status").select("format_config_id, is_placeholder, baseline_format_config_id"),
    getRecomputeStatus(admin, Date.now()),
  ]);
  const placeholderRow = (fmtStatus ?? []).find((s) => s.format_config_id === formatId);
  const baselineSlug = placeholderRow?.baseline_format_config_id
    ? formats.find((f) => f.id === placeholderRow.baseline_format_config_id)?.slug ?? null
    : null;

  return (
    <BeaconPageShell
      title="Rankings & Values"
      description="Every FF Beacon player by format and position: value, rank, offset-aware movement, and the full signal breakdown. This is the surface for reviewing all 9 formats."
      recompute={recompute}
    >
      <RankingsReview
        rows={review.rows}
        formats={formats.map((f) => ({ slug: f.slug }))}
        currentFormat={currentFormat}
        currentPosition={currentPosition}
        isPlaceholder={Boolean(placeholderRow?.is_placeholder)}
        baselineSlug={baselineSlug}
        total={review.total}
        cap={RANKINGS_CAP}
      />
    </BeaconPageShell>
  );
}

async function loadReview(
  admin: ReturnType<typeof createAdminClient>,
  formatId: string,
  position: string,
): Promise<{ rows: ReviewRow[]; total: number }> {
  const { data: trends } = await admin
    .from("player_value_trends")
    .select("player_id, current_value, change_7d, change_30d, change_90d, show_trend_7d, show_trend_30d, show_trend_90d, players!inner(first_name, last_name, position, team)")
    .eq("source", "ffbeacon")
    .eq("format_config_id", formatId)
    .order("current_value", { ascending: false })
    .limit(1000);

  const ranked = (trends ?? []).map((t, i) => ({ t, rank: i + 1 }));
  const filtered = position === "ALL"
    ? ranked
    : ranked.filter((r) => (r.t.players as unknown as { position: string }).position === position);
  const total = filtered.length;
  const capped = filtered.slice(0, RANKINGS_CAP);

  const ids = capped.map((r) => r.t.player_id);
  const metaByPlayer = new Map<string, Record<string, unknown>>();
  if (ids.length > 0) {
    const { data: hist } = await admin
      .from("player_value_history")
      .select("player_id, metadata")
      .eq("source", "ffbeacon")
      .eq("format_config_id", formatId)
      .in("player_id", ids);
    for (const h of hist ?? []) metaByPlayer.set(h.player_id, (h.metadata as Record<string, unknown>) ?? {});
  }

  const rows: ReviewRow[] = capped.map(({ t, rank }) => {
    const p = t.players as unknown as { first_name: string; last_name: string; position: string; team: string | null };
    return {
      playerId: t.player_id,
      name: `${p.first_name} ${p.last_name}`,
      position: p.position,
      team: p.team,
      value: Number(t.current_value),
      rank,
      change7d: t.change_7d === null ? null : Number(t.change_7d),
      change30d: t.change_30d === null ? null : Number(t.change_30d),
      change90d: t.change_90d === null ? null : Number(t.change_90d),
      show7d: t.show_trend_7d, show30d: t.show_trend_30d, show90d: t.show_trend_90d,
      metadata: metaByPlayer.get(t.player_id) ?? null,
    };
  });
  return { rows, total };
}
