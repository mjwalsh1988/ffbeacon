/**
 * Community rankings, step 3: the fitted strengths to ranked rows. PURE.
 *
 * A player is listed only once minBoardsPerPlayer counted boards had him ON
 * the board, so no row is one reader's opinion restated. Ranks are WITHIN the
 * player's connected group (migration 0309): strength descending, ties by
 * player id so the order never depends on how the rows arrived.
 */

export type CommunityRankRow = {
  playerId: string;
  position: string;
  strength: number;
  group: string;
  overallRank: number;
  positionRank: number;
  previousRank: number | null;
  boardsCount: number;
};

export type RankInput = {
  fit: ReadonlyMap<string, { strength: number; group: string }>;
  positions: ReadonlyMap<string, string>;
  boardsCount: ReadonlyMap<string, number>;
  minBoardsPerPlayer: number;
  /** The previous build's overall_rank per player, when there was one. */
  previousRanks?: ReadonlyMap<string, number>;
};

/** Rows ordered by group (as first seen by strength) then overall rank. */
export function rankCommunity(input: RankInput): CommunityRankRow[] {
  const candidates: Array<{ playerId: string; position: string; strength: number; group: string; boards: number }> = [];
  for (const [playerId, fitted] of input.fit) {
    const boards = input.boardsCount.get(playerId) ?? 0;
    if (boards < input.minBoardsPerPlayer) continue;
    const position = input.positions.get(playerId);
    if (!position) continue;
    candidates.push({ playerId, position, strength: fitted.strength, group: fitted.group, boards });
  }

  const byGroup = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const list = byGroup.get(c.group);
    if (list) list.push(c);
    else byGroup.set(c.group, [c]);
  }

  const out: CommunityRankRow[] = [];
  const groupNames = [...byGroup.keys()].sort(
    (a, b) => (byGroup.get(b)?.length ?? 0) - (byGroup.get(a)?.length ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const group of groupNames) {
    const list = byGroup.get(group) ?? [];
    list.sort(
      (a, b) =>
        b.strength - a.strength || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
    );
    const positionCounters = new Map<string, number>();
    list.forEach((c, i) => {
      const positionRank = (positionCounters.get(c.position) ?? 0) + 1;
      positionCounters.set(c.position, positionRank);
      out.push({
        playerId: c.playerId,
        position: c.position,
        strength: c.strength,
        group,
        overallRank: i + 1,
        positionRank,
        previousRank: input.previousRanks?.get(c.playerId) ?? null,
        boardsCount: c.boards,
      });
    });
  }
  return out;
}
