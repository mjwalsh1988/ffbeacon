import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ListOrdered, Layers } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  isBoardScope,
  scopeDescription,
  scopeLabel,
  type BoardScope,
} from "@/lib/ranking-boards";
import { CreateBoardForm } from "./create-board-form";
import { DeleteBoardButton } from "./delete-board-button";

export const metadata: Metadata = {
  title: "My Rankings",
  description:
    "Build your own custom player ranking boards. Rank everyone, or go position by position, with optional tiers.",
};

type BoardSummary = {
  id: string;
  name: string;
  scope: BoardScope;
  tiers_enabled: boolean;
  playerCount: number;
  updated_at: string;
};

export default async function MyRankingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("user_ranking_boards")
    .select(
      "id, name, scope, tiers_enabled, updated_at, user_ranking_board_players(count)",
    )
    .eq("user_id", user!.id)
    .order("created_at", { ascending: true });

  const boards: BoardSummary[] = (data ?? []).map((row) => {
    const countRel = row.user_ranking_board_players as unknown as
      | { count: number }[]
      | null;
    return {
      id: row.id,
      name: row.name,
      scope: isBoardScope(row.scope) ? row.scope : "overall",
      tiers_enabled: row.tiers_enabled,
      playerCount: countRel?.[0]?.count ?? 0,
      updated_at: row.updated_at,
    };
  });

  return (
    <div className="space-y-12">
      <section aria-labelledby="rankings-intro-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-2xl">
            <SectionEyebrow>Your boards</SectionEyebrow>
            <h2
              id="rankings-intro-heading"
              className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Rank players your way.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Build an overall board ranking every active player, or position
              specific boards, or both. Drag players around or use the move
              buttons, and turn on tiers whenever you want them. These boards
              are yours alone for now and will power your public profile later.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <CreateBoardForm />
        </div>
      </section>

      <section aria-labelledby="board-list-heading">
        <SectionEyebrow>Saved boards</SectionEyebrow>
        <h2
          id="board-list-heading"
          className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          {boards.length === 0
            ? "No boards yet."
            : `${boards.length} board${boards.length === 1 ? "" : "s"}`}
        </h2>

        {boards.length === 0 ? (
          <div className="mt-6 flex items-start gap-4 rounded-card border border-dashed border-line bg-base/40 p-6">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
            >
              <ListOrdered className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold text-ink">
                Create your first ranking board above.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                Pick &ldquo;Overall&rdquo; to rank everyone, or choose a single
                position to focus on one spot.
              </p>
            </div>
          </div>
        ) : (
          <ul role="list" className="mt-6 grid gap-4 sm:grid-cols-2">
            {boards.map((board) => (
              <li
                key={board.id}
                className="flex flex-col rounded-card border border-line bg-surface p-5 transition-colors hover:border-brand-purple/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-base px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
                      {scopeLabel(board.scope)}
                    </span>
                    <h3 className="mt-3 truncate text-lg font-semibold text-ink">
                      {board.name}
                    </h3>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {scopeDescription(board.scope)}
                    </p>
                  </div>
                  <DeleteBoardButton boardId={board.id} boardName={board.name} />
                </div>

                <dl className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-card border border-line/60 bg-base/60 px-2.5 py-1 text-ink-muted">
                    <dt className="sr-only">Players ranked</dt>
                    <dd>
                      <span className="font-mono font-semibold text-ink">
                        {board.playerCount}
                      </span>{" "}
                      player{board.playerCount === 1 ? "" : "s"}
                    </dd>
                  </span>
                  {board.tiers_enabled && (
                    <span className="inline-flex items-center gap-1.5 rounded-card border border-line/60 bg-base/60 px-2.5 py-1 text-ink-muted">
                      <Layers aria-hidden="true" className="h-3.5 w-3.5 text-brand-purple" />
                      Tiers on
                    </span>
                  )}
                </dl>

                <Link
                  href={`/my-beacon/rankings/${board.id}`}
                  className="mt-4 inline-flex items-center gap-1 self-start text-sm font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  aria-label={`Open and edit board ${board.name}`}
                >
                  Open board
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
