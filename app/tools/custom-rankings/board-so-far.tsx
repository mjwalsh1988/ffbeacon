"use client";

import { PlayerHeadshot } from "@/components/player-headshot";
import { PositionChip } from "@/components/position-chip";
import { TierBreakLine } from "@/components/ranking-boards/tier-break-line";
import { RankGapChip } from "@/components/ranking-boards/rank-gap-chip";
import { normalizeTierBreaks, tierForRank, tierRanges } from "@/lib/ranking-boards";
import { readerRanksFor, rankGap, type RankComparison } from "@/lib/ranking-boards/compare";
import type { CardPlayer } from "@/lib/ranking-boards/card-text";

/**
 * The board so far (plan section 13.4): one real ordered list, drawn as a rail
 * on wide screens and as a disclosure under the cards below that (the caller
 * chooses the wrapper). The player being asked about is outlined in purple and
 * the player he is compared with in cyan, so the eye can follow the question;
 * each of those rows also SAYS so in words, because an outline is invisible to
 * a screen reader.
 */
export function BoardSoFar({
  board,
  cards,
  climbing,
  opponent,
  breaks,
  comparison,
}: {
  board: string[];
  cards: Record<string, CardPlayer>;
  climbing: string | null;
  opponent: string | null;
  breaks: number[];
  comparison: RankComparison | null;
}) {
  if (board.length === 0) {
    return <p className="text-sm text-ink-muted">Nobody is on the board yet.</p>;
  }
  const clean = normalizeTierBreaks(breaks, board.length).breaks;
  const players = board.map((id) => ({ playerId: id, position: cards[id]?.position ?? "" }));
  const readerRanks = comparison ? readerRanksFor(players, comparison) : null;
  const ranges = clean.length > 0 ? tierRanges(clean, board.length) : null;

  const row = (id: string, index: number) => {
    const p = cards[id];
    const rank = index + 1;
    const isClimbing = id === climbing;
    const isOpponent = id === opponent;
    return (
      <li
        key={id}
        className={`flex flex-wrap items-center gap-2 rounded-card border px-2 py-1.5 ${
          isClimbing
            ? "border-brand-purple bg-brand-purple/10"
            : isOpponent
              ? "border-brand-cyan bg-brand-cyan/10"
              : "border-line/60 bg-base/40"
        }`}
      >
        <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface px-1 font-mono text-xs font-bold tabular-nums text-ink">
          <span className="sr-only">Rank </span>
          {rank}
          {ranges && <span className="sr-only">, tier {tierForRank(clean, rank)}</span>}
        </span>
        <PlayerHeadshot sleeperId={p?.sleeperId} position={p?.position} name={p?.name ?? ""} size={28} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {p?.name ?? "Unknown player"}
          {isClimbing && <span className="sr-only">, being asked about now</span>}
          {isOpponent && <span className="sr-only">, the player he is compared with</span>}
        </span>
        <PositionChip position={p?.position} />
        {comparison && p && (
          <RankGapChip
            gap={rankGap(comparison, p, readerRanks?.get(id))}
            subject={comparison.subject}
          />
        )}
      </li>
    );
  };

  if (!ranges) {
    return (
      <ol className="flex flex-col gap-1">
        {board.map(row)}
      </ol>
    );
  }
  return (
    <div className="space-y-2">
      {ranges.map((r) => (
        <div key={r.tier}>
          <TierBreakLine tier={r.tier} label={null} />
          <ol start={r.start} className="flex flex-col gap-1">
            {board.slice(r.start - 1, r.end).map((id, i) => row(id, r.start - 1 + i))}
          </ol>
        </div>
      ))}
    </div>
  );
}
