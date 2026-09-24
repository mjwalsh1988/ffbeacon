/**
 * The current season's game log, on the Overview tab under the depth chart.
 *
 * WHY IT IS HERE TOO. The Statistics tab has always had it, behind a click.
 * "What has he done, and who does he play next" is the question the overview
 * exists to answer, and sending a reader to another tab for the week-by-week
 * was sending them away from the page they had just landed on.
 *
 * ONE SEASON, NO PICKER. The Statistics tab owns the full career with its
 * accuracy charts and its season switcher. This is deliberately the short
 * version: the current season, the same rows, and a link to the longer one.
 * The per-stat beat/miss sub-line is off, because that reading needs the
 * toggle and the legend that live on the other tab.
 *
 * FALLING BACK TO LAST SEASON. Between February and the first projection
 * release there is no current-season slate at all, so the log would be an
 * empty frame. It shows the previous season instead and SAYS SO in the panel's
 * own helper line, rather than letting a reader assume those are this year's
 * games. A season label that a reader has to infer from the numbers is the
 * failure mode here.
 *
 * Server component. It loads nothing the Statistics tab does not, and every
 * read is a cached one those two now share.
 */

import { gameLogHelper } from "@/lib/player-profile/game-log-helper";
import { currentNflSeason } from "@/lib/nfl-season";
import Link from "next/link";
import { Panel } from "@/components/dashboard-panel";
import { GameLogTable } from "@/components/player-profile/game-log-table";
import { toGameRow, buildPendingWeeks } from "@/lib/player-profile/game-log";
import { loadSeasonScheduleCached } from "@/lib/season-schedule";
import {
  loadWeeklyStatsCached,
  loadProjectionsMapCached,
} from "@/lib/player-profile-cache";
import type {
  PlayerRow,
  ScoringKey,
  PlayerProjections,
} from "@/lib/player-profile";
import type { WeeklyGameRow } from "@/components/player-profile/stat-shaping";

export async function OverviewGameLog({
  player,
  playerName,
  scoringKey,
  scoringLabel,
  tePremiumBonus,
  projections,
}: {
  player: PlayerRow;
  playerName: string;
  scoringKey: ScoringKey;
  scoringLabel: string;
  tePremiumBonus: number;
  /** The weekly projections the overview already loaded. Not re-read here. */
  projections: PlayerProjections;
}) {
  const [weeklyRaw, projMap] = await Promise.all([
    loadWeeklyStatsCached(player.id),
    // Deliberately NOT given the resolved source: it grades published history
    // across every season and only Sleeper has one. Same call the Statistics
    // tab makes, so the two share a cache entry rather than each paying.
    loadProjectionsMapCached(player.id),
  ]);

  const gameRows: WeeklyGameRow[] = weeklyRaw.map((r) =>
    toGameRow(r, projMap, scoringKey, tePremiumBonus),
  );

  /**
   * Which season this shows.
   *
   * The projection season when we hold one, because that is the season with a
   * slate and therefore the season a reader is asking about. Otherwise the
   * newest season the player has a stat line in, which is last year.
   */
  const projectionSeason = projections.season;
  const newestPlayed = gameRows.reduce<number | null>(
    (best, r) => (best == null || r.season > best ? r.season : best),
    null,
  );
  const season = projectionSeason ?? newestPlayed;
  if (season == null) return null;

  const isFallback = projectionSeason == null;

  const rows = gameRows
    .filter((r) => r.season === season)
    .sort((a, b) => a.week - b.week);

  // Only the live season gets placeholder weeks. A finished season already
  // holds a row per game its team played, so inventing "upcoming" weeks for
  // last year would be inventing a schedule that has already happened.
  const schedule = isFallback
    ? { kickoffs: {}, weeksCovered: [] }
    : await loadSeasonScheduleCached(season);
  const pending = isFallback
    ? []
    : buildPendingWeeks({
        playedWeeks: new Set(rows.map((r) => r.week)),
        projectionWeeks: projections.rows,
        schedule,
        team: player.team,
      });

  if (rows.length === 0 && pending.length === 0) return null;

  // Only asked on the fallback branch, and cached: is a LATER season already
  // on the slate? If so, "next season has not been published" is false.
  const liveSeason = Number(currentNflSeason());
  const laterSeasonScheduled =
    isFallback && liveSeason > season
      ? (await loadSeasonScheduleCached(liveSeason)).weeksCovered.length > 0
      : false;

  return (
    <Panel
      eyebrow={`${season} season`}
      title="Game log"
      helper={gameLogHelper({ season, isFallback, laterSeasonScheduled })}
      headingLevel={2}
      action={
        <Link
          href={`/players/${player.slug}?tab=statistics`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Full stats
          <span className="sr-only"> for {playerName}, including every season</span>
        </Link>
      }
      bodyClassName="px-0 py-0"
    >
      <GameLogTable
        position={player.position}
        season={season}
        rows={rows}
        pending={pending}
        scoringLabel={scoringLabel}
        // Stamped on the server so "is this game today" is decided once, in
        // Eastern, rather than read off each reader's clock and disagreeing
        // with the HTML on hydration.
        nowIso={new Date().toISOString()}
        caption={`${playerName}, ${season} weekly stat lines`}
      />
    </Panel>
  );
}
