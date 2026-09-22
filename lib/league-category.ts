import type { SleeperLeague } from "@/lib/sleeper";
import type { TeamStatusKey } from "@/lib/league-team-status";

/**
 * The buckets we group a user's Sleeper leagues into on every league list.
 * Order here is the display order, matching how most managers scan for one.
 *
 * CHOPPED IS ITS OWN BUCKET AS OF 2026-09-22, REVERSING AN EARLIER DECISION.
 * It used to fold into Redraft on the grounds that the two price the same way,
 * which is true and turned out not to be the useful part. A chopped league is
 * a different GAME: one roster is eliminated every week, trades are usually
 * off, the budget never resets, and the site now has a whole guide and a
 * calculator mode for it. A manager scanning a list for "the guillotine one"
 * was being shown it filed under Redraft with nothing to distinguish it. We
 * hold 33 of them, which is more than the 22 best ball leagues that already
 * had two buckets to themselves.
 *
 * CHOPPED DOES NOT SPLIT BY BEST BALL, AND THE OTHER TWO DO. Dynasty and
 * redraft each get a best ball sibling because best ball genuinely changes how
 * those are played. For chopped, elimination is the dominant fact and best ball
 * is a detail on top of it, and we hold exactly one best-ball chopped league in
 * 592. A fifth chip that can only ever show one row is a worse outcome than
 * filing that league under Chopped, which is what it mostly is.
 *
 * Keeper leagues (type 1) still group into Redraft: they price the same and
 * they play the same week to week. Only true dynasty (type 2) gets Dynasty.
 */
export type LeagueCategoryKey =
  "dynasty" | "redraft" | "chopped" | "best-ball-dynasty" | "best-ball-redraft";

export interface LeagueCategoryGroup {
  key: LeagueCategoryKey;
  label: string;
  leagues: SleeperLeague[];
}

export const CATEGORY_ORDER: { key: LeagueCategoryKey; label: string }[] = [
  { key: "dynasty", label: "Dynasty" },
  { key: "redraft", label: "Redraft" },
  // After Redraft rather than at the end: a chopped league is a one-year
  // format and a reader scanning for one looks near the redraft rooms.
  { key: "chopped", label: "Chopped" },
  { key: "best-ball-dynasty", label: "Best Ball Dynasty" },
  { key: "best-ball-redraft", label: "Best Ball Redraft" },
];

/**
 * Classify one league into a display bucket.
 *
 * Best ball is read straight off `settings.best_ball` (Sleeper sets it to 1 for
 * best ball rooms). Dynasty is detected STRICTLY by `settings.type === 2`, and
 * chopped by `settings.type === 3`.
 *
 * CHOPPED IS TESTED BEFORE BEST BALL, which is the one ordering decision in
 * here. See the type's own header: elimination is the dominant fact about that
 * format and we hold one best-ball chopped league in 592, so it files under
 * Chopped rather than earning a fifth chip that shows a single row.
 *
 * We deliberately do NOT treat a carried-over `previous_league_id` as a dynasty
 * signal here: Sleeper sets previous_league_id on ANY league continued season
 * to season, including redraft leagues, so leaning on it misfiles continued
 * redraft leagues (e.g. "Brooklyn 99 Redraft", type 0 with a prior season) as
 * dynasty. lib/sleeper-to-format.ts now classifies the same way, so a continued
 * redraft league groups as redraft AND prices off the redraft board.
 *
 * NOTE for anything that PRICES a league rather than labelling it: a chopped
 * league still prices off the redraft board, and `lib/sleeper-to-format.ts` is
 * unchanged. This function answers "what kind of room is this", not "which
 * value board applies". The two were the same answer until today and are not
 * any more.
 *
 * Sleeper league types: 0 = redraft, 1 = keeper, 2 = dynasty, 3 = chopped.
 */
/** The display label for one bucket, so a filter chip and a group heading agree. */
export function leagueCategoryLabel(key: LeagueCategoryKey): string {
  return CATEGORY_ORDER.find((c) => c.key === key)?.label ?? "Other";
}

export function categorizeLeague(league: SleeperLeague): LeagueCategoryKey {
  const type = Number(league.settings?.type ?? 0);
  if (type === 3) return "chopped";
  const isBestBall = Number(league.settings?.best_ball ?? 0) === 1;
  const isDynasty = type === 2;
  if (isBestBall) return isDynasty ? "best-ball-dynasty" : "best-ball-redraft";
  return isDynasty ? "dynasty" : "redraft";
}

/**
 * Where each standing sits in the list, inside its category.
 *
 * Competing teams first, because they are the ones with something to do this
 * week. Loaded teams second: they are in the picture too, and they are the ones
 * carrying assets a trade could turn into wins, which makes them the most
 * actionable rooms on the list after the contenders. Rebuilders and Longshots
 * last. A league we hold no standing for lands past them: it is not a claim that
 * the team is bad, it is the absence of a claim, and the bottom is where a row
 * goes when the sort has nothing to say about it.
 */
const STANDING_ORDER: Record<TeamStatusKey, number> = {
  competitor: 0,
  loaded: 1,
  middle: 2,
  rebuilder: 3,
};
const UNRANKED_ORDER = 4;

/** A league id to the standing of THIS reader's team in it, where we have one. */
export type StandingLookup = Readonly<
  Record<string, TeamStatusKey | null | undefined>
>;

function standingOrder(
  league: SleeperLeague,
  standings: StandingLookup,
): number {
  const key = standings[league.league_id];
  return key ? STANDING_ORDER[key] : UNRANKED_ORDER;
}

/**
 * Group leagues into the ordered category buckets. Within a bucket, leagues run
 * Contender, Loaded, Bubble, then Rebuilder or Longshot, then whatever has no
 * standing yet, and alphabetically (case- and accent-insensitive) inside each
 * band.
 * Empty buckets are dropped so the UI only renders sections that actually have
 * leagues. Input order is not mutated.
 *
 * READS WHAT IS ALREADY LOADED. The standing comes from the caller's existing
 * team-status map, which is read from cache. Sorting never triggers a sync, so a
 * league nobody has pulsed sorts to the bottom of its category and stays there
 * until something else syncs it.
 *
 * Name is the tiebreaker rather than the finish or the roster value, so the
 * order inside a band cannot move when a value sync lands. The bands answer
 * "who needs my attention"; the names keep a league findable between visits.
 */
export function groupLeaguesByCategory(
  leagues: SleeperLeague[],
  standings: StandingLookup = {},
): LeagueCategoryGroup[] {
  const buckets = new Map<LeagueCategoryKey, SleeperLeague[]>();
  for (const league of leagues) {
    const key = categorizeLeague(league);
    const arr = buckets.get(key);
    if (arr) arr.push(league);
    else buckets.set(key, [league]);
  }

  const groups: LeagueCategoryGroup[] = [];
  for (const { key, label } of CATEGORY_ORDER) {
    const arr = buckets.get(key);
    if (!arr || arr.length === 0) continue;
    arr.sort((a, b) => {
      const byStanding =
        standingOrder(a, standings) - standingOrder(b, standings);
      if (byStanding !== 0) return byStanding;
      return (a.name ?? "").localeCompare(b.name ?? "", undefined, {
        sensitivity: "base",
      });
    });
    groups.push({ key, label, leagues: arr });
  }
  return groups;
}
