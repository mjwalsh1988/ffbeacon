/**
 * Community rankings: which boards count (plan section 9.1). PURE.
 *
 * A board counts when its owner has not opted out, it has a format, and it
 * ranks enough players: minPlayersMulti for an overall or all-defense board,
 * minPlayersSingle for a one position board. Of the boards that pass, ONE
 * counts per (account, format, scope), the most recently changed, so one person
 * with ten copies counts once. An overall board with defenders switched on is
 * the same scope as one without. Guest boards live in another table and never
 * reach this function.
 */

import { BOARD_SCOPES, isSinglePositionScope, type BoardScope } from "@/lib/ranking-boards";
import type { RankingBuilderSettings } from "@/lib/ranking-boards/default-settings";

export type RawCommunityBoard = {
  id: string;
  userId: string;
  scope: string;
  includesDefenders: boolean;
  formatConfigId: string | null;
  optOut: boolean;
  updatedAt: string;
  playerCount: number;
};

export type EligibilitySettings = Pick<
  RankingBuilderSettings["community"],
  "minPlayersMulti" | "minPlayersSingle"
>;

function isBoardScope(scope: string): scope is BoardScope {
  return (BOARD_SCOPES as readonly string[]).includes(scope);
}

/** The minimum player count for a board of this scope to count. */
export function minPlayersFor(scope: BoardScope, settings: EligibilitySettings): number {
  return isSinglePositionScope(scope) ? settings.minPlayersSingle : settings.minPlayersMulti;
}

function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** The boards that count, in a stable order (format, scope, user). */
export function countedBoards<B extends RawCommunityBoard>(
  boards: readonly B[],
  settings: EligibilitySettings,
): B[] {
  const winners = new Map<string, B>();
  for (const board of boards) {
    if (board.optOut) continue;
    if (!board.formatConfigId) continue;
    if (!isBoardScope(board.scope)) continue;
    if (board.playerCount < minPlayersFor(board.scope, settings)) continue;
    const key = `${board.userId}|${board.formatConfigId}|${board.scope}`;
    const current = winners.get(key);
    if (
      !current ||
      timeOf(board.updatedAt) > timeOf(current.updatedAt) ||
      (timeOf(board.updatedAt) === timeOf(current.updatedAt) && board.id > current.id)
    ) {
      winners.set(key, board);
    }
  }
  return [...winners.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, board]) => board);
}

/**
 * The counted boards, how many count in each format, and how many distinct
 * accounts those boards come from. One person can count once per scope, so a
 * reader with an overall board and four position boards is five boards but one
 * account. The publish threshold is measured in ACCOUNTS: five boards from one
 * person is still one person's opinion.
 */
export function eligibleBoardsByFormat<B extends RawCommunityBoard>(
  boards: readonly B[],
  settings: EligibilitySettings,
): { boards: B[]; countsByFormat: Map<string, number>; accountsByFormat: Map<string, number> } {
  const counted = countedBoards(boards, settings);
  const countsByFormat = new Map<string, number>();
  const users = new Map<string, Set<string>>();
  for (const board of counted) {
    const format = board.formatConfigId as string;
    countsByFormat.set(format, (countsByFormat.get(format) ?? 0) + 1);
    const set = users.get(format);
    if (set) set.add(board.userId);
    else users.set(format, new Set([board.userId]));
  }
  const accountsByFormat = new Map<string, number>();
  for (const [format, set] of users) accountsByFormat.set(format, set.size);
  return { boards: counted, countsByFormat, accountsByFormat };
}

/** Whether a format publishes: enough distinct people, not enough boards. */
export function isFormatPublished(eligibleAccounts: number, minBoardsToPublish: number): boolean {
  return eligibleAccounts >= minBoardsToPublish;
}
