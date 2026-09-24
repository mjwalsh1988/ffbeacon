import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus } from "@/lib/beacon-admin";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";
import { RankingsReview, type ReviewRow } from "@/components/admin/rankings-review";
import {
  DraftPicksReview,
  type PickRow,
  type PickCombo,
} from "@/components/admin/draft-picks-review";
import { ViewTabs } from "@/components/admin/view-tabs";
import { fetchAllRows, fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";

export const metadata: Metadata = { title: "Rankings & Values" };
export const dynamic = "force-dynamic";

const RANKINGS_CAP = 250;
const FLAGSHIP = "dynasty-ppr-sflex";
const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

export default async function BeaconRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    format?: string;
    position?: string;
    pickSource?: string;
    pickFormat?: string;
  }>;
}) {
  await requireAdmin("/admin/beacon/rankings");
  const admin = createAdminClient();
  const sp = await searchParams;

  const { data: sourceRows } = await admin
    .from("source_registry").select("slug, display_name, supported_format_slugs, is_active");
  const ffSlugs =
    (sourceRows ?? []).find((s) => s.slug === "ffbeacon")?.supported_format_slugs ?? [];
  const sourceDisplayBySlug = new Map(
    (sourceRows ?? []).map((s) => [s.slug, s.display_name ?? s.slug]),
  );

  const { data: fmtRows } = await admin
    .from("format_configs").select("id, slug, display_order").order("display_order");
  const allFormats = fmtRows ?? [];
  const formats = allFormats.filter((f) => ffSlugs.includes(f.slug));
  const formatIdBySlug = new Map(formats.map((f) => [f.slug, f.id]));
  const orderByFormatId = new Map<string, number>(allFormats.map((f) => [f.id, f.display_order ?? 999]));

  const currentFormat = sp.format && formatIdBySlug.has(sp.format) ? sp.format : FLAGSHIP;
  const currentPosition = (sp.position ?? "ALL").toUpperCase();
  const formatId = formatIdBySlug.get(currentFormat)!;

  // Draft pick combos: which (source, format) pairs actually have stored picks.
  // Only active sources are checked, so retired sources drop off.
  const activeSources = (sourceRows ?? []).filter((s) => s.is_active).map((s) => s.slug);
  // A failed check hides the picks tab rather than listing some of the combos.
  const combos = await loadPickCombos(admin, activeSources, allFormats, orderByFormatId, sourceDisplayBySlug)
    .catch((err: unknown) => {
      console.error("[admin/beacon/rankings] pick combos:", err);
      return [] as PickCombo[];
    });

  // Resolve the selected pick source + format with graceful fallback.
  const pickSourceSlugs = [...new Set(combos.map((c) => c.source))];
  const currentPickSource =
    sp.pickSource && pickSourceSlugs.includes(sp.pickSource)
      ? sp.pickSource
      : pickSourceSlugs.includes("ffbeacon")
        ? "ffbeacon"
        : (pickSourceSlugs[0] ?? "");
  const formatsForPickSource = combos
    .filter((c) => c.source === currentPickSource)
    .map((c) => c.formatSlug);
  const currentPickFormat =
    sp.pickFormat && formatsForPickSource.includes(sp.pickFormat)
      ? sp.pickFormat
      : formatsForPickSource.includes(FLAGSHIP)
        ? FLAGSHIP
        : (formatsForPickSource[0] ?? "");
  const pickFormatId = currentPickFormat
    ? allFormats.find((f) => f.slug === currentPickFormat)?.id ?? null
    : null;

  // Tabs. Picks tab only exists when some source actually stores picks; with no
  // picks the page is a single panel and renders no tab strip.
  const hasPicks = combos.length > 0;
  const view = hasPicks && sp.view === "picks" ? "picks" : "players";

  // Only the active tab's (heavy) data is loaded; the recompute status is needed
  // by the page shell on both tabs.
  const [recompute, review, { data: fmtStatus }, picks] = await Promise.all([
    getRecomputeStatus(admin, Date.now()),
    view === "players"
      ? loadReview(admin, formatId, currentPosition)
      : Promise.resolve({ rows: [] as ReviewRow[], total: 0 }),
    view === "players"
      ? admin.from("beacon_format_status").select("format_config_id, is_placeholder, baseline_format_config_id")
      : Promise.resolve({ data: [] as Array<{ format_config_id: string; is_placeholder: boolean; baseline_format_config_id: string | null }> }),
    view === "picks" && pickFormatId
      ? loadPicks(admin, currentPickSource, pickFormatId)
      : Promise.resolve({ picks: [] as PickRow[], total: 0, capturedAt: null as string | null }),
  ]);
  const placeholderRow = (fmtStatus ?? []).find((s) => s.format_config_id === formatId);
  const baselineSlug = placeholderRow?.baseline_format_config_id
    ? formats.find((f) => f.id === placeholderRow.baseline_format_config_id)?.slug ?? null
    : null;

  const sharedParams = {
    format: currentFormat,
    position: currentPosition,
    pickSource: currentPickSource,
    pickFormat: currentPickFormat,
  };
  const hrefFor = (v: string) =>
    `/admin/beacon/rankings?${new URLSearchParams({ ...sharedParams, view: v }).toString()}`;

  return (
    <BeaconPageShell
      title="Rankings & Values"
      description="Every FF Beacon player by format and position: value, rank, offset-aware movement, and the full signal breakdown. This is the surface for reviewing all 9 formats, plus stored draft pick values for every source."
      recompute={recompute}
    >
      {hasPicks && (
        <ViewTabs
          label="Rankings views"
          current={view}
          tabs={[
            { key: "players", label: "Players", href: hrefFor("players") },
            { key: "picks", label: "Draft picks", href: hrefFor("picks") },
          ]}
        />
      )}

      {view === "players" ? (
        <RankingsReview
          rows={review.rows}
          formats={formats.map((f) => ({ slug: f.slug }))}
          currentFormat={currentFormat}
          currentPosition={currentPosition}
          isPlaceholder={Boolean(placeholderRow?.is_placeholder)}
          baselineSlug={baselineSlug}
          total={review.total}
          cap={RANKINGS_CAP}
          preserveParams={{ view: "players", pickSource: currentPickSource, pickFormat: currentPickFormat }}
        />
      ) : (
        <DraftPicksReview
          combos={combos}
          currentSource={currentPickSource}
          currentFormat={currentPickFormat}
          sourceDisplay={sourceDisplayBySlug.get(currentPickSource) ?? currentPickSource}
          picks={picks.picks}
          total={picks.total}
          capturedAt={picks.capturedAt}
          preserveParams={{ view: "picks", format: currentFormat, position: currentPosition }}
        />
      )}
    </BeaconPageShell>
  );
}

async function loadPickCombos(
  admin: ReturnType<typeof createAdminClient>,
  sources: string[],
  formats: Array<{ id: string; slug: string }>,
  orderByFormatId: Map<string, number>,
  sourceDisplayBySlug: Map<string, string>,
): Promise<PickCombo[]> {
  // One existence check per (source, format). A newest-N window over the whole
  // table let a busy source crowd the others out of it.
  const pairs = sources.flatMap((source) => formats.map((f) => ({ source, f })));
  const found = await Promise.all(
    pairs.map(async ({ source, f }) => {
      const { data, error } = await admin
        .from("draft_pick_values")
        .select("id")
        .eq("source", source)
        .eq("format_config_id", f.id)
        .limit(1);
      if (error) throw new Error(`draft pick combos ${source}/${f.slug}: ${error.message}`);
      return (data ?? []).length > 0;
    }),
  );

  const combos: Array<PickCombo & { order: number }> = [];
  pairs.forEach(({ source, f }, i) => {
    if (!found[i]) return;
    combos.push({
      source,
      sourceDisplay: sourceDisplayBySlug.get(source) ?? source,
      formatSlug: f.slug,
      order: orderByFormatId.get(f.id) ?? 999,
    });
  });
  combos.sort(
    (a, b) =>
      a.sourceDisplay.localeCompare(b.sourceDisplay) || a.order - b.order,
  );
  return combos.map(({ order: _order, ...c }) => c);
}

async function loadPicks(
  admin: ReturnType<typeof createAdminClient>,
  source: string,
  formatId: string,
): Promise<{ picks: PickRow[]; total: number; capturedAt: string | null }> {
  const { data: latest } = await admin
    .from("draft_pick_values")
    .select("captured_at")
    .eq("source", source)
    .eq("format_config_id", formatId)
    .order("captured_at", { ascending: false })
    .limit(1);
  const capturedAt = latest?.[0]?.captured_at ?? null;
  if (!capturedAt) return { picks: [], total: 0, capturedAt: null };

  const { data: rows } = await admin
    .from("draft_pick_values")
    .select("season, round, pick_position, value")
    .eq("source", source)
    .eq("format_config_id", formatId)
    .eq("captured_at", capturedAt);

  const list = (rows ?? []).map((r) => ({
    season: r.season,
    round: r.round,
    position: r.pick_position,
    value: Number(r.value),
  }));
  list.sort((a, b) => b.value - a.value);
  const total = list.reduce((sum, p) => sum + p.value, 0);
  const picks: PickRow[] = list.map((p, i) => ({
    ...p,
    rank: i + 1,
    label: pickLabel(p.season, p.round, p.position),
  }));
  return { picks, total, capturedAt };
}

/**
 * The metadata on each player's NEWEST FF Beacon row for one format. Reads the
 * newest snapshot first, then walks full history only for players missing from
 * it, keeping the first row per player in (player_id, captured_at desc) order.
 */
async function loadLatestMetadata(
  admin: ReturnType<typeof createAdminClient>,
  formatId: string,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return out;

  const { data: latest, error: latestErr } = await admin
    .from("player_value_history")
    .select("captured_at")
    .eq("source", "ffbeacon")
    .eq("format_config_id", formatId)
    .order("captured_at", { ascending: false })
    .limit(1);
  if (latestErr) throw new Error(`beacon rankings newest capture: ${latestErr.message}`);
  const newest = latest?.[0]?.captured_at;
  if (!newest) return out;

  const atNewest = await fetchAllRowsInChunks("beacon rankings metadata", ids, (chunk, from, to) =>
    admin
      .from("player_value_history")
      .select("player_id, metadata")
      .eq("source", "ffbeacon")
      .eq("format_config_id", formatId)
      .eq("captured_at", newest)
      .in("player_id", chunk)
      .order("player_id", { ascending: true })
      .range(from, to),
  );
  for (const h of atNewest) out.set(h.player_id, (h.metadata as Record<string, unknown>) ?? {});

  const missing = ids.filter((id) => !out.has(id));
  if (missing.length === 0) return out;
  const older = await fetchAllRowsInChunks("beacon rankings older metadata", missing, (chunk, from, to) =>
    admin
      .from("player_value_history")
      .select("player_id, metadata")
      .eq("source", "ffbeacon")
      .eq("format_config_id", formatId)
      .in("player_id", chunk)
      .order("player_id", { ascending: true })
      .order("captured_at", { ascending: false })
      .range(from, to),
  );
  for (const h of older) {
    if (!out.has(h.player_id)) out.set(h.player_id, (h.metadata as Record<string, unknown>) ?? {});
  }
  return out;
}

function pickLabel(season: number, round: number, position: string): string {
  const slot =
    position && position !== "unknown"
      ? `${position.charAt(0).toUpperCase()}${position.slice(1)} `
      : "";
  const ord = ORDINALS[round] ?? `${round}th`;
  return `${season} ${slot}${ord}`;
}

async function loadReview(
  admin: ReturnType<typeof createAdminClient>,
  formatId: string,
  position: string,
): Promise<{ rows: ReviewRow[]; total: number }> {
  const trends = await fetchAllRows("beacon rankings trends", (from, to) =>
    admin
      .from("player_value_trends")
      .select("player_id, current_value, change_7d, change_30d, change_90d, show_trend_7d, show_trend_30d, show_trend_90d, players!inner(first_name, last_name, position, team)")
      .eq("source", "ffbeacon")
      .eq("format_config_id", formatId)
      .order("current_value", { ascending: false })
      .order("player_id", { ascending: true })
      .range(from, to),
  );

  const ranked = trends.map((t, i) => ({ t, rank: i + 1 }));
  const filtered = position === "ALL"
    ? ranked
    : ranked.filter((r) => (r.t.players as unknown as { position: string }).position === position);
  const total = filtered.length;
  const capped = filtered.slice(0, RANKINGS_CAP);

  const ids = capped.map((r) => r.t.player_id);
  const metaByPlayer = await loadLatestMetadata(admin, formatId, ids);

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
