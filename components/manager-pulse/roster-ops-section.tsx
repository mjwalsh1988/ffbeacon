/**
 * Section 6.6: roster management.
 *
 * Every field on `ManagerRosterOps` is scale-free (a rate, a share, a count,
 * a record), so every field is a `PoolableStat` and reads straight through
 * `underLens`, the same as `ResultsSection`. Nothing here needs the per-type
 * "show both" treatment the value-priced Trading section does.
 *
 * Three wording rules carry real weight and are enforced here rather than
 * left to whoever reads the raw numbers:
 *
 *   1. Lineup efficiency ALWAYS shows its coverage next to it, because
 *      `lineupEfficiencySampleSize` (leagues with a manager-ledger row) is
 *      usually far smaller than this manager's total league-seasons for the
 *      lens (a ledger row only exists for a league someone has opened in
 *      League Pulse). `totalLeagueSeasons` supplies that denominator; it is
 *      not on `ManagerRosterOps` itself, so the caller passes it in (the page
 *      has it on `report.counts`).
 *   2. `avgFaabBidShare === null` means the manager's leagues run no FAAB at
 *      all, per the field's own doc comment on `ManagerRosterOps`, not that
 *      they never placed a bid. Said in words rather than left as a dash a
 *      reader could misread as "never bid".
 *   3. Abandonment is reported as a bare count of what it counts. No
 *      adjective, no warning color: a manager who stops setting a lineup is a
 *      fact about a season, not a character judgment.
 */

import { SectionFrame } from "./section-frame";
import { StatTile } from "./stat-tile";
import { formatCount, formatPercent, formatRate, formatRecord } from "./format";
import { underLens } from "@/components/manager-shell/lens";
import type { LensCounts } from "@/components/manager-shell/lens";
import type { LeagueLens, ManagerRosterOps, MoveShape } from "@/lib/manager-pulse/types";

const MOVE_SHAPE_LABEL: Record<MoveShape, string> = {
  "front-loaded": "Front-loaded",
  steady: "Steady",
  faded: "Faded",
};

const MOVE_SHAPE_SUB: Record<MoveShape, string> = {
  "front-loaded": "Most moves land in the first weeks of the season.",
  steady: "Moves spread evenly across the season.",
  faded: "Moves taper off as the season goes.",
};

export function RosterOpsSection({
  rosterOps,
  totalLeagueSeasons,
  lens,
}: {
  rosterOps: ManagerRosterOps;
  /** League-seasons of the active lens, so the lineup-efficiency coverage line can state "of how many". */
  totalLeagueSeasons: LensCounts;
  lens: LeagueLens;
}) {
  const movesPerWeek = underLens(rosterOps.movesPerWeek, lens);
  const moveShape = underLens(rosterOps.moveShape, lens);
  const waiverClaimsPerSeason = underLens(rosterOps.waiverClaimsPerSeason, lens);
  const avgFaabBidShare = underLens(rosterOps.avgFaabBidShare, lens);
  const waiverPointsProduced = underLens(rosterOps.waiverPointsProduced, lens);
  const lineupEfficiency = underLens(rosterOps.lineupEfficiency, lens);
  const lineupEfficiencySampleSize = underLens(rosterOps.lineupEfficiencySampleSize, lens);
  const bestLineupRecord = underLens(rosterOps.bestLineupRecord, lens);
  const winsLeftOnBench = underLens(rosterOps.winsLeftOnBench, lens);
  const abandonmentCount = underLens(rosterOps.abandonmentCount, lens);

  const totalForLens =
    lens === "dynasty"
      ? totalLeagueSeasons.dynasty
      : lens === "redraft"
        ? totalLeagueSeasons.redraft
        : totalLeagueSeasons.leagueSeasons;

  return (
    <SectionFrame id="roster-ops" title="Roster management" accent="cyan">
      {/* One grid, not three stacked pairs. Nine figures in rows of two put
          this section's own footer below the fold on a laptop; three across
          from sm fits the same nine in three rows with nothing dropped. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* The section's one hero figure: how busy this manager is, which is
            what every other tile here qualifies. */}
        <StatTile
          label="Moves per week"
          value={movesPerWeek === null ? null : formatRate(movesPerWeek)}
          size="hero"
          emptyReason="Not enough measured weeks"
        />
        <StatTile
          label="Move shape"
          value={moveShape === null ? null : MOVE_SHAPE_LABEL[moveShape]}
          sub={moveShape === null ? undefined : MOVE_SHAPE_SUB[moveShape]}
          emptyReason="Not enough seasons to see a shape"
        />
        <StatTile
          label="Waiver claims per season"
          value={waiverClaimsPerSeason === null ? null : formatRate(waiverClaimsPerSeason)}
          emptyReason="No waiver claims in this window"
        />
        <StatTile
          label="Average FAAB bid share"
          value={avgFaabBidShare === null ? null : formatPercent(avgFaabBidShare)}
          emptyReason="These leagues run no FAAB"
        />
        <StatTile
          label="Waiver points produced"
          value={waiverPointsProduced === null ? null : formatCount(waiverPointsProduced)}
          sub="Points scored by players added off waivers, for the team that added them."
          emptyReason="No waiver claims in this window"
        />
        <StatTile
          label="Abandonment"
          value={abandonmentCount === null ? null : formatCount(abandonmentCount)}
          sub="Seasons that ended with several quiet weeks and an incomplete lineup."
          emptyReason="No settled seasons yet"
        />
      </div>

      {/* Lineup efficiency never appears alone: the coverage clause is the
          whole point, since a ledger row only exists for a league someone has
          opened in League Pulse, and that is almost always fewer seasons than
          this manager's total. */}
      <StatTile
        label="Lineup efficiency"
        value={lineupEfficiency === null ? null : formatPercent(lineupEfficiency)}
        sub={
          lineupEfficiency === null
            ? undefined
            : `Of available points, measured in ${formatCount(lineupEfficiencySampleSize)} of ${formatCount(totalForLens)} seasons.`
        }
        emptyReason="No measured seasons yet"
      />

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Best-lineup record"
          value={bestLineupRecord === null ? null : formatRecord(bestLineupRecord)}
          sub="The record their optimal lineup would have produced."
          emptyReason="No settled weeks yet"
        />
        <StatTile
          label="Wins left on bench"
          value={winsLeftOnBench === null ? null : formatCount(winsLeftOnBench)}
          emptyReason="No settled weeks yet"
        />
      </div>
    </SectionFrame>
  );
}
