import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GitCompare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getActiveFormats, getAvailableSources, pickDefaultSource } from "@/lib/source";
import { resolveFormatSlug } from "@/lib/preferences";
import {
  isBoardScope,
  readSleeperId,
  scopeLabel,
  type BoardPlayer,
  type BoardScope,
} from "@/lib/ranking-boards";
import { loadBeaconComparison } from "@/lib/ranking-boards/beacon-comparison";
import { loadCommunityComparison } from "@/lib/ranking-boards/community-comparison";
import { isSinglePositionScope } from "@/lib/ranking-boards";
import { loadRankingBuilderSettings } from "@/lib/ranking-boards/settings";
import { createAdminClient } from "@/lib/supabase/server";
import { BoardEditor } from "./board-editor";

export const metadata: Metadata = {
  title: "Edit board",
};

type PlayerJoin = {
  slug: string;
  first_name: string;
  last_name: string;
  full_name: string | null;
  position: string;
  team: string | null;
  external_ids: Record<string, unknown> | null;
};

export default async function BoardEditorPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const supabase = await createClient();

  // RLS scopes this to the owner; a non-owner (or bad id) gets no row.
  const { data: board } = await supabase
    .from("user_ranking_boards")
    .select(
      "id, name, scope, includes_defenders, tiers_enabled, tier_breaks, tier_labels, format_config_id, seed_source_slug, community_opt_out",
    )
    .eq("id", boardId)
    .maybeSingle();

  if (!board) {
    notFound();
  }

  const scope: BoardScope = isBoardScope(board.scope) ? board.scope : "overall";

  // Everything the page needs that does not depend on the player rows goes out
  // in one wave with them.
  const [playerRows, formats, registry, readerFormat, builderSettings] = await Promise.all([
    // Paged: a board can hold more players than one request returns. A failed
    // page throws, because an editor opened on part of a board would save part
    // of a board.
    fetchAllRows("ranking board players", (from, to) =>
      supabase
        .from("user_ranking_board_players")
        .select(
          "id, player_id, rank_position, players!inner(slug, first_name, last_name, full_name, position, team, external_ids)",
        )
        .eq("board_id", boardId)
        .order("rank_position", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    getActiveFormats(supabase),
    getAvailableSources(supabase),
    resolveFormatSlug(supabase, undefined),
    loadRankingBuilderSettings(createAdminClient()),
  ]);

  const initialPlayers: BoardPlayer[] = playerRows.map((row) => {
    const p = row.players as unknown as PlayerJoin;
    return {
      rowId: row.id,
      playerId: row.player_id,
      slug: p.slug,
      name: p.full_name ?? `${p.first_name} ${p.last_name}`,
      position: p.position,
      team: p.team,
      sleeperId: readSleeperId(p.external_ids),
    };
  });

  const tierLabels = (board.tier_labels ?? {}) as Record<string, string>;
  const boardFormat = formats.find((f) => f.id === board.format_config_id) ?? null;

  const [beacon, community] = await Promise.all([
    loadBeaconComparison(supabase, {
      scope,
      boardFormatSlug: boardFormat?.slug ?? null,
      readerFormatSlug: readerFormat.slug,
    }),
    loadCommunityComparison({ scope, formatConfigId: board.format_config_id }),
  ]);

  // Source + format options for "Start from our rankings". Only sources that
  // actually publish rankings are offered.
  const rankingSources = registry.filter((s) => s.data_type.includes("rankings"));
  const importSources = rankingSources.map((s) => ({
    slug: s.slug,
    displayName: s.display_name,
    supportedFormatSlugs: s.supported_format_slugs,
  }));
  const importFormats = formats.map((f) => ({ slug: f.slug, displayName: f.display_name }));
  const defaultSourceSlug = board.seed_source_slug ?? pickDefaultSource(rankingSources);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/my-beacon/rankings"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          All boards
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
            {scopeLabel(scope, board.includes_defenders)}
          </span>
          {boardFormat && (
            <span className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {boardFormat.display_name}
            </span>
          )}
        </div>
        <p className="mt-3 text-sm text-ink-muted">{beacon.note}</p>
        {/* Build by comparing: Beacon Ranker opened on this board, which
            re-checks it two players at a time from the top or a chosen rank. */}
        <Link
          href={`/tools/custom-rankings?board=${board.id}`}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <GitCompare aria-hidden="true" className="h-4 w-4" />
          Build by comparing
        </Link>
      </div>

      <BoardEditor
        boardId={board.id}
        initialName={board.name}
        scope={scope}
        includesDefenders={board.includes_defenders}
        initialTiersEnabled={board.tiers_enabled}
        initialTierBreaks={board.tier_breaks ?? []}
        initialTierLabels={tierLabels}
        initialPlayers={initialPlayers}
        importSources={importSources}
        importFormats={importFormats}
        defaultSourceSlug={defaultSourceSlug}
        boardFormatSlug={boardFormat?.slug ?? null}
        comparisons={[beacon.comparison, community].filter(
          (c): c is NonNullable<typeof c> => c !== null,
        )}
        community={{
          optOut: board.community_opt_out,
          minPlayers: isSinglePositionScope(scope)
            ? builderSettings.community.minPlayersSingle
            : builderSettings.community.minPlayersMulti,
          hasFormat: Boolean(board.format_config_id),
          formats: importFormats,
        }}
      />
    </div>
  );
}
