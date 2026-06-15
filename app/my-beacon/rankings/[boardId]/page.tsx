import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  isBoardScope,
  readSleeperId,
  scopeLabel,
  type BoardPlayer,
  type BoardScope,
} from "@/lib/ranking-boards";
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
    .select("id, name, scope, tiers_enabled, tier_count, tier_labels")
    .eq("id", boardId)
    .maybeSingle();

  if (!board) {
    notFound();
  }

  const { data: playerRows } = await supabase
    .from("user_ranking_board_players")
    .select(
      "id, player_id, rank_position, tier, players!inner(slug, first_name, last_name, full_name, position, team, external_ids)",
    )
    .eq("board_id", boardId)
    .order("rank_position", { ascending: true });

  const initialPlayers: BoardPlayer[] = (playerRows ?? []).map((row) => {
    const p = row.players as unknown as PlayerJoin;
    return {
      rowId: row.id,
      playerId: row.player_id,
      slug: p.slug,
      name: p.full_name ?? `${p.first_name} ${p.last_name}`,
      position: p.position,
      team: p.team,
      sleeperId: readSleeperId(p.external_ids),
      tier: row.tier,
    };
  });

  const scope: BoardScope = isBoardScope(board.scope) ? board.scope : "overall";
  const tierLabels = (board.tier_labels ?? {}) as Record<string, string>;

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
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
            {scopeLabel(scope)}
          </span>
        </div>
      </div>

      <BoardEditor
        boardId={board.id}
        initialName={board.name}
        scope={scope}
        initialTiersEnabled={board.tiers_enabled}
        initialTierCount={board.tier_count}
        initialTierLabels={tierLabels}
        initialPlayers={initialPlayers}
      />
    </div>
  );
}
