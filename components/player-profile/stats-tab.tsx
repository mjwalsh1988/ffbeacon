/**
 * Statistics tab (server). Three stacked panels: positional finishes for every
 * scoring format (a season x scoring matrix), career totals by season, and a
 * weekly game log with a season picker (client child). Points are read on the
 * server from the metadata jsonb and passed down as plain GameRows so the client
 * table needs no server imports.
 */

import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/dashboard-panel";
import { finishLabel } from "@/components/player-profile/positional-finishes";
import { WeeklyStats } from "@/components/player-profile/weekly-stats";
import {
  aggregateSeasons,
  statColumns,
  StatScroll,
  type GameRow,
} from "@/components/player-profile/stat-shaping";
import {
  loadPositionalFinishes,
  loadWeeklyStats,
  readPoints,
  SCORING_KEYS,
  type PlayerRow,
  type PositionalFinish,
  type ScoringKey,
  type WeeklyStatRow,
} from "@/lib/player-profile";

const POS_CLASS: Record<string, string> = {
  QB: "bg-position-qb/15 text-position-qb",
  RB: "bg-position-rb/15 text-position-rb",
  WR: "bg-position-wr/15 text-position-wr",
  TE: "bg-position-te/15 text-position-te",
  K: "bg-position-k/15 text-position-k",
  DEF: "bg-position-def/15 text-position-def",
};

function posClass(position: string): string {
  return POS_CLASS[(position || "").toUpperCase()] ?? "bg-ink-subtle/15 text-ink-muted";
}

function toGameRow(r: WeeklyStatRow): GameRow {
  return {
    season: r.season,
    week: r.week,
    opponent: r.opponent,
    snap_pct: r.snap_pct,
    gp: r.gp,
    pass_cmp: r.pass_cmp ?? 0,
    pass_att: r.pass_att ?? 0,
    pass_yd: r.pass_yd ?? 0,
    pass_td: r.pass_td ?? 0,
    pass_int: r.pass_int ?? 0,
    rush_att: r.rush_att ?? 0,
    rush_yd: r.rush_yd ?? 0,
    rush_td: r.rush_td ?? 0,
    rec: r.rec ?? 0,
    rec_tgt: r.rec_tgt ?? 0,
    rec_yd: r.rec_yd ?? 0,
    rec_td: r.rec_td ?? 0,
    pts_ppr: readPoints(r.metadata, "pts_ppr"),
  };
}

export async function StatsTab({ player }: { player: PlayerRow }) {
  const supabase = await createClient();
  const [finishes, weeklyRaw] = await Promise.all([
    loadPositionalFinishes(supabase, player.id),
    loadWeeklyStats(supabase, player.id),
  ]);

  const gameRows = weeklyRaw.map(toGameRow);
  const seasonAggs = aggregateSeasons(gameRows);
  const cols = statColumns(player.position);

  // Finishes matrix: season -> scoring -> finish.
  const bySeasonScoring = new Map<number, Map<ScoringKey, PositionalFinish>>();
  for (const f of finishes) {
    let m = bySeasonScoring.get(f.season);
    if (!m) {
      m = new Map();
      bySeasonScoring.set(f.season, m);
    }
    m.set(f.scoring, f);
  }
  const finishSeasons = Array.from(bySeasonScoring.keys()).sort((a, b) => b - a);

  // Weekly rows grouped by season for the client picker.
  const rowsBySeason: Record<number, GameRow[]> = {};
  for (const r of gameRows) {
    (rowsBySeason[r.season] ??= []).push(r);
  }
  const weeklySeasons = Object.keys(rowsBySeason)
    .map(Number)
    .sort((a, b) => b - a);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Positional finishes by format */}
      <Panel
        eyebrow="Production"
        title="Positional finishes by format"
        helper="Season-end rank within position by fantasy points, per scoring format."
        bodyClassName="p-0"
      >
        {finishSeasons.length > 0 ? (
          <StatScroll caption={`${player.position} positional finishes by season and scoring format`}>
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Season
                  </th>
                  {SCORING_KEYS.map((s) => (
                    <th key={s.key} scope="col" className="px-4 py-2.5 text-right font-semibold">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {finishSeasons.map((season) => {
                  const row = bySeasonScoring.get(season);
                  return (
                    <tr key={season} className="hover:bg-surface">
                      <th
                        scope="row"
                        className="whitespace-nowrap px-4 py-2.5 text-left font-mono font-medium text-ink"
                      >
                        {season}
                      </th>
                      {SCORING_KEYS.map((s) => {
                        const f = row?.get(s.key);
                        return (
                          <td key={s.key} className="px-4 py-2.5 text-right">
                            {f ? (
                              <span
                                className={`inline-flex rounded-md px-1.5 font-mono text-sm font-bold tabular-nums ${posClass(
                                  player.position,
                                )}`}
                              >
                                {finishLabel(player.position, f.finish)}
                              </span>
                            ) : (
                              <span className="text-ink-subtle">-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </StatScroll>
        ) : (
          <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">
            No scored seasons on file to compute positional finishes.
          </p>
        )}
      </Panel>

      {/* Career by season */}
      <Panel
        eyebrow="Production"
        title="Career by season"
        helper="Regular-season totals. PPR points shown for a consistent baseline."
        bodyClassName="p-0"
      >
        {seasonAggs.length > 0 ? (
          <StatScroll caption={`Career regular-season totals by year`}>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    Season
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    G
                  </th>
                  {cols.map((c) => (
                    <th key={c.label} scope="col" className="px-4 py-2.5 text-right font-semibold">
                      {c.label}
                    </th>
                  ))}
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    PPR
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                    PPR/G
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {seasonAggs.map((s) => {
                  const ppg = s.games > 0 ? s.line.pts_ppr / s.games : null;
                  return (
                    <tr key={s.season} className="hover:bg-surface">
                      <th
                        scope="row"
                        className="whitespace-nowrap px-4 py-2.5 text-left font-mono font-medium text-ink"
                      >
                        {s.season}
                      </th>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-muted">
                        {s.games}
                      </td>
                      {cols.map((c) => (
                        <td
                          key={c.label}
                          className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-muted"
                        >
                          {c.get(s.line)}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">
                        {s.line.pts_ppr.toFixed(1)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-brand-cyan">
                        {ppg !== null ? ppg.toFixed(1) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </StatScroll>
        ) : (
          <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">
            No statistical history on file for this player.
          </p>
        )}
      </Panel>

      {/* Weekly game log with season picker */}
      <Panel
        eyebrow="Game log"
        title="Weekly stats"
        helper="Week by week, earliest to latest. Choose a season to view."
      >
        {weeklySeasons.length > 0 ? (
          <WeeklyStats
            position={player.position}
            rowsBySeason={rowsBySeason}
            seasons={weeklySeasons}
          />
        ) : (
          <p className="text-sm text-ink-muted">No weekly stat lines on file yet.</p>
        )}
      </Panel>
    </div>
  );
}
