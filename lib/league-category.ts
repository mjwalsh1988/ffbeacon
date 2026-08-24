import type { SleeperLeague } from "@/lib/sleeper";
import type { TeamStatusKey } from "@/lib/league-team-status";

/**
 * The buckets we group a user's Sleeper leagues into on the league-pulse
 * results list. Order here is the display order (Dynasty first, then Redraft,
 * then their Best Ball siblings), matching how most managers scan for a league.
 *
 * Chopped/guillotine (Sleeper settings.type === 3) is intentionally NOT its own
 * bucket per product decision: those leagues group into Redraft (or Best Ball
 * Redraft). Keeper leagues (type 1) group into Redraft too. Only true dynasty
 * (type 2) gets the Dynasty bucket.
 */
export type LeagueCategoryKey =
  "dynasty" | "redraft" | "best-ball-dynasty" | "best-ball-redraft";

export interface LeagueCategoryGroup {
  key: LeagueCategoryKey;
  label: string;
  leagues: SleeperLeague[];
}

const CATEGORY_ORDER: { key: LeagueCategoryKey; label: string }[] = [
  { key: "dynasty", label: "Dynasty" },
  { key: "redraft", label: "Redraft" },
  { key: "best-ball-dynasty", label: "Best Ball Dynasty" },
  { key: "best-ball-redraft", label: "Best Ball Redraft" },
];

/**
 * Classify one league into a display bucket.
 *
 * Best ball is read straight off `settings.best_ball` (Sleeper sets it to 1 for
 * best ball rooms). Dynasty is detected STRICTLY by `settings.type === 2`.
 *
 * We deliberately do NOT treat a carried-over `previous_league_id` as a dynasty
 * signal here: Sleeper sets previous_league_id on ANY league continued season
 * to season, including redraft leagues, so leaning on it misfiles continued
 * redraft leagues (e.g. "Brooklyn 99 Redraft", type 0 with a prior season) as
 * dynasty. lib/sleeper-to-format.ts now classifies the same way, so a continued
 * redraft league groups as redraft AND prices off the redraft board.
 *
 * Sleeper league types: 0 = redraft, 1 = keeper, 2 = dynasty, 3 = chopped.
 * Only type 2 is dynasty; every other type groups as redraft (or best-ball
 * redraft), which is where keeper and chopped leagues land.
 */
export function categorizeLeague(league: SleeperLeague): LeagueCategoryKey {
  const isBestBall = Number(league.settings?.best_ball ?? 0) === 1;
  const isDynasty = Number(league.settings?.type ?? 0) === 2;
  if (isBestBall) return isDynasty ? "best-ball-dynasty" : "best-ball-redraft";
  return isDynasty ? "dynasty" : "redraft";
}

/**
 * Where each standing sits in the list, inside its category.
 *
 * Competing teams first, because they are the ones with something to do this
 * week. Rebuilders and Longshots last for the same reason. A league we hold no
 * standing for lands past them: it is not a claim that the team is bad, it is the
 * absence of a claim, and the bottom is where a row goes when the sort has
 * nothing to say about it.
 */
const STANDING_ORDER: Record<TeamStatusKey, number> = {
  competitor: 0,
  middle: 1,
  rebuilder: 2,
};
const UNRANKED_ORDER = 3;

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
 * Contender, Bubble, then Rebuilder or Longshot, then whatever has no standing
 * yet, and alphabetically (case- and accent-insensitive) inside each band.
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
