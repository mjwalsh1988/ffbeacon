// Shared public board (Top-N) view, used by BOTH the root
// /{handle}/rankings/{boardId} alias and the legacy
// /u/{handle}/rankings/{boardId} route. Keeping the render here keeps the two
// routes byte-identical; each route file supplies the segment config
// (revalidate) and a `canonicalBase`.
//
// `canonicalBase` is the prefix used for the canonical URL, the casing 301
// target, and the back-to-profile links:
//   - "/u" while /u is canonical (Phase 7 Stage B)
//   - ""   once root is canonical (Phase 7 Stage C)
//
// The render is unchanged from the original /u/[handle]/rankings/[boardId] page:
// this is a pure relocation plus the canonicalBase parameter.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SITE } from "@/lib/site";
import { loadPublicBoard, type BoardTopNPlayer } from "@/lib/signal-profile";
import { scopeLabel, tierLabel } from "@/lib/ranking-boards";

export async function buildBoardMetadata(
  rawHandle: string,
  boardId: string,
  { canonicalBase }: { canonicalBase: string },
): Promise<Metadata> {
  const view = await loadPublicBoard(boardId);
  // Only published+public boards owned by a live profile resolve here.
  if (!view || view.owner.handle.toLowerCase() !== rawHandle.toLowerCase()) {
    return { title: "Board not found", robots: { index: false, follow: false } };
  }
  const title = `${view.board.name} by ${view.owner.displayName}`;
  const url = `${SITE.url}${canonicalBase}/${view.owner.handle}/rankings/${view.board.id}`;
  return {
    title,
    description: `${view.owner.displayName}'s ${scopeLabel(view.board.scope)} ranking board on ${SITE.name}.`,
    alternates: { canonical: url },
    openGraph: { type: "article", title, url },
    twitter: { card: "summary", title },
  };
}

export async function BoardView({
  rawHandle,
  boardId,
  canonicalBase,
}: {
  rawHandle: string;
  boardId: string;
  canonicalBase: string;
}) {
  const view = await loadPublicBoard(boardId);
  if (!view) notFound();

  // The board's canonical owner handle must match the URL. Redirect mismatched
  // (or stale) handles to the canonical address.
  if (view.owner.handle.toLowerCase() !== rawHandle.toLowerCase()) {
    permanentRedirect(
      `${canonicalBase}/${view.owner.handle}/rankings/${view.board.id}`,
    );
  }

  const { board, owner, players } = view;
  const profileHref = `${canonicalBase}/${owner.handle}`;

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link
        href={profileHref}
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
        Back to {owner.displayName}
      </Link>

      <header className="mt-4 border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          {scopeLabel(board.scope)} board
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {board.name}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {players.length} player{players.length === 1 ? "" : "s"} ranked by{" "}
          <Link
            href={profileHref}
            className="font-medium text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {owner.displayName}
          </Link>
          .
        </p>
      </header>

      {players.length === 0 ? (
        <p className="mt-6 rounded-card border border-dashed border-line bg-base/40 p-6 text-sm text-ink-muted">
          This board has no players yet.
        </p>
      ) : board.tiersEnabled ? (
        <TieredBoard players={players} tierLabels={board.tierLabels} />
      ) : (
        <PlayerList players={players} className="mt-6" />
      )}
    </main>
  );
}

function TieredBoard({
  players,
  tierLabels,
}: {
  players: BoardTopNPlayer[];
  tierLabels: Record<string, string>;
}) {
  // Group by tier in rank order; the "No tier" bucket renders last.
  const tiers: number[] = [];
  const byTier = new Map<number | null, BoardTopNPlayer[]>();
  for (const p of players) {
    const key = p.tier ?? null;
    if (!byTier.has(key)) {
      byTier.set(key, []);
      if (key !== null) tiers.push(key);
    }
    byTier.get(key)!.push(p);
  }
  tiers.sort((a, b) => a - b);
  const ordered: Array<{ tier: number | null; label: string }> = [
    ...tiers.map((t) => ({ tier: t, label: tierLabel(tierLabels, t) })),
  ];
  if (byTier.has(null)) ordered.push({ tier: null, label: "No tier" });

  return (
    <div className="mt-6 space-y-6">
      {ordered.map((group) => {
        const items = byTier.get(group.tier) ?? [];
        const headingId = `tier-${group.tier ?? "none"}`;
        return (
          <section
            key={headingId}
            aria-labelledby={headingId}
            className="rounded-card border border-line bg-surface/40 p-4"
          >
            <h2
              id={headingId}
              className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-ink-muted"
            >
              {group.tier !== null && (
                <span
                  aria-hidden="true"
                  className="inline-flex h-7 min-w-7 items-center justify-center rounded-card border border-brand-purple/40 bg-brand-purple/10 px-2 font-mono text-sm font-semibold text-brand-purple"
                >
                  {group.tier}
                </span>
              )}
              {group.label}
            </h2>
            <PlayerList players={items} />
          </section>
        );
      })}
    </div>
  );
}

function PlayerList({
  players,
  className = "",
}: {
  players: BoardTopNPlayer[];
  className?: string;
}) {
  return (
    <ol role="list" className={`flex flex-col gap-1.5 ${className}`}>
      {players.map((p) => (
        <li
          key={p.playerId}
          className="flex items-center gap-3 rounded-card border border-line/60 bg-base/50 px-3 py-2"
        >
          <span className="w-8 shrink-0 text-center font-mono text-sm tabular-nums text-ink-muted">
            {p.rank}
          </span>
          <Link
            href={`/players/${p.slug}`}
            className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {p.name}
          </Link>
          <span className="shrink-0 text-xs text-ink-muted">
            {p.position}
            {p.team ? `, ${p.team}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
