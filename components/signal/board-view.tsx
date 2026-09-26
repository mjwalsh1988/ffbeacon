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
// The page is cached (the routes set revalidate), so nothing here reads a
// cookie: a board with no saved format compares with FF Beacon in the site's
// default format, and the note says so.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DEFAULT_FORMAT_SLUG, SITE } from "@/lib/site";
import { loadPublicBoard, type BoardTopNPlayer } from "@/lib/signal-profile";
import { scopeDescription, scopeLabel, tierRanges } from "@/lib/ranking-boards";
import {
  agreementShare,
  biggestDisagreements,
  readerRanksFor,
  rankGap,
  type RankComparison,
} from "@/lib/ranking-boards/compare";
import { loadBeaconComparison } from "@/lib/ranking-boards/beacon-comparison";
import { loadCommunityComparison } from "@/lib/ranking-boards/community-comparison";
import { getActiveFormats } from "@/lib/source";
import { createCachedReadClient } from "@/lib/supabase/server";
import { itemListJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { TierBreakLine } from "@/components/ranking-boards/tier-break-line";
import { RankGapChip } from "@/components/ranking-boards/rank-gap-chip";
import { DisagreeFigure } from "@/components/ranking-boards/disagree-figure";

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
  const description = `${view.owner.displayName}'s ${scopeLabel(view.board.scope, view.board.includesDefenders)} fantasy football rankings on ${SITE.name}, ${view.players.length} players ranked. ${scopeDescription(view.board.scope, view.board.includesDefenders)}`;
  const ogImage = `${SITE.url}/api/og/board/${view.owner.handle}/${view.board.id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      title,
      description,
      url,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
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
    permanentRedirect(`${canonicalBase}/${view.owner.handle}/rankings/${view.board.id}`);
  }

  const { board, owner, players } = view;
  const profileHref = `${canonicalBase}/${owner.handle}`;

  const readClient = createCachedReadClient();
  const formats = await getActiveFormats(readClient);
  const boardFormat = formats.find((f) => f.id === board.formatConfigId) ?? null;
  const beacon = await loadBeaconComparison(readClient, {
    scope: board.scope,
    boardFormatSlug: boardFormat?.slug ?? null,
    readerFormatSlug: DEFAULT_FORMAT_SLUG,
    readerFormatIsSiteDefault: true,
    restrictTo: players.map((p) => p.playerId),
  });
  const comparison = beacon.comparison;
  const community = await loadCommunityComparison({
    scope: board.scope,
    formatConfigId: board.formatConfigId,
    restrictTo: players.map((p) => p.playerId),
  });
  // Two figures, two labels, never one column for both (plan 13.7).
  const columns = [comparison, community]
    .filter((c): c is RankComparison => c !== null)
    .map((c) => ({ comparison: c, readerRanks: readerRanksFor(players, c) }));
  const readerRanks = comparison ? readerRanksFor(players, comparison) : null;
  const gaps = comparison
    ? players.map((p) => rankGap(comparison, p, readerRanks?.get(p.playerId)))
    : [];
  const agreement = agreementShare(gaps);
  const disagreements = comparison ? biggestDisagreements(players, comparison) : null;

  // The ranked players exactly as rendered below, so the ItemList never claims
  // more than the page shows.
  const itemList =
    players.length > 0
      ? itemListJsonLd(
          players.map((p) => ({
            position: p.rank,
            url: `${SITE.url}/players/${p.slug}`,
            name: p.name,
          })),
        )
      : null;

  const ranges = board.tiersEnabled ? tierRanges(board.tierBreaks, players.length) : null;

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {itemList && (
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemList) }}
        />
      )}

      <Link
        href={profileHref}
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
        Back to {owner.displayName}
      </Link>

      <header className="mt-4 border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          {scopeLabel(board.scope, board.includesDefenders)} board
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
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="About this board">
          {boardFormat && <Chip>{boardFormat.display_name}</Chip>}
          <Chip>{scopeLabel(board.scope, board.includesDefenders)}</Chip>
          {agreement && (
            <Chip>
              {Math.round(agreement.share * 100)}% within 3 spots of FF Beacon
            </Chip>
          )}
        </ul>
        <p className="mt-3 text-xs text-ink-subtle">{beacon.note}</p>
      </header>

      {players.length === 0 ? (
        <p className="mt-6 rounded-card border border-dashed border-line bg-base/40 p-6 text-sm text-ink-muted">
          This board has no players yet.
        </p>
      ) : ranges ? (
        <div className="mt-6 space-y-5">
          {ranges.map((range) => {
            const headingId = `tier-${range.tier}`;
            const custom = board.tierLabels[String(range.tier)]?.trim() || null;
            return (
              <section key={range.tier} aria-labelledby={headingId}>
                <TierBreakLine tier={range.tier} label={custom} headingLevel={2} id={headingId} />
                <PlayerList
                  players={players.slice(range.start - 1, range.end)}
                  start={range.start}
                  columns={columns}
                />
              </section>
            );
          })}
        </div>
      ) : (
        <PlayerList
          players={players}
          start={1}
          columns={columns}
          className="mt-6"
        />
      )}

      {disagreements &&
        (disagreements.higher.length > 0 || disagreements.lower.length > 0) && (
          <section aria-labelledby="board-vs-beacon" className="mt-8">
            <h2 id="board-vs-beacon" className="text-lg font-semibold tracking-tight text-ink">
              Compared with FF Beacon
            </h2>
            <div className="mt-3">
              <DisagreeFigure
                higher={disagreements.higher}
                lower={disagreements.lower}
                subject="FF Beacon"
                owner={owner.displayName}
                titleLevel={3}
              />
            </div>
          </section>
        )}

      {/* Shared boards are the page most likely to arrive from outside the
          site, so the invitation lives on every one. */}
      <aside className="mt-8 rounded-card border border-line bg-surface p-5">
        <p className="text-sm text-ink-muted">
          Think {owner.displayName} has it wrong?
        </p>
        <Link
          href="/tools/custom-rankings"
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Build your own fantasy football rankings like this one
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </aside>
    </main>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-1 text-xs font-medium text-ink-muted">
      {children}
    </li>
  );
}

function PlayerList({
  players,
  start,
  columns,
  className = "",
}: {
  players: BoardTopNPlayer[];
  start: number;
  columns: { comparison: RankComparison; readerRanks: Map<string, number> }[];
  className?: string;
}) {
  return (
    <ol start={start} className={`flex flex-col gap-1.5 ${className}`}>
      {players.map((p) => (
        <li
          key={p.playerId}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line/60 bg-base/50 px-3 py-2"
        >
          <span className="w-8 shrink-0 text-center font-mono text-sm tabular-nums text-ink-muted">
            <span className="sr-only">Rank </span>
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
          {columns.map(({ comparison, readerRanks }) => (
            <span key={comparison.label} className="flex shrink-0 items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.1em] text-ink-subtle">
                {comparison.label}
              </span>
              <RankGapChip
                gap={rankGap(comparison, p, readerRanks.get(p.playerId))}
                subject={comparison.subject}
              />
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}
