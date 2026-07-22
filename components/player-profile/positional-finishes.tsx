/**
 * Positional finish badges. A finish like "WR4" is the player's season-end rank
 * within their position by fantasy points for the active scoring (computed by
 * the get_player_positional_finishes RPC). Shared by the hero and the overview
 * sidebar; the statistics tab renders its own multi-format matrix.
 */

import { SCORING_KEYS, type PositionalFinish, type ScoringKey } from "@/lib/player-profile";

const POS_CLASS: Record<string, string> = {
  QB: "bg-position-qb/15 text-position-qb",
  RB: "bg-position-rb/15 text-position-rb",
  WR: "bg-position-wr/15 text-position-wr",
  TE: "bg-position-te/15 text-position-te",
  K: "bg-position-k/15 text-position-k",
  DEF: "bg-position-def/15 text-position-def",
};

export function finishLabel(position: string, finish: number): string {
  return `${(position || "").toUpperCase()}${finish}`;
}

function posClass(position: string): string {
  return POS_CLASS[(position || "").toUpperCase()] ?? "bg-ink-subtle/15 text-ink-muted";
}

/**
 * A newest-first row of up to N season finish cards. `finishes` must already be
 * filtered to a single scoring and sliced to the seasons to show.
 */
export function LastThreeFinishes({
  position,
  finishes,
  emptyLabel = "No positional finishes yet",
  compact = false,
}: {
  position: string;
  finishes: PositionalFinish[];
  emptyLabel?: string;
  /** Compact mode: on mobile the cards shrink and split the row evenly so all
   *  three fit on one line; at sm and up they restore to their natural size. */
  compact?: boolean;
}) {
  if (finishes.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyLabel}</p>;
  }
  return (
    <ol className={compact ? "flex gap-1.5 sm:flex-wrap sm:gap-2" : "flex flex-wrap gap-2"}>
      {finishes.map((f) => {
        const label = finishLabel(position, f.finish);
        return (
          <li
            key={`${f.season}-${f.scoring}`}
            className={`rounded-card border border-line bg-surface/60 text-center ${
              compact
                ? "min-w-0 flex-1 px-2 py-1.5 sm:flex-none sm:px-3 sm:py-2"
                : "px-3 py-2"
            }`}
            aria-label={`${f.season} finish: ${label}`}
          >
            <p
              className={`font-semibold uppercase tracking-wide text-ink-subtle ${
                compact ? "text-[9px] sm:text-[10px]" : "text-[10px]"
              }`}
            >
              {f.season}
            </p>
            <p
              className={`mt-0.5 inline-flex rounded-md font-mono font-bold tabular-nums ${posClass(
                position,
              )} ${compact ? "px-1 text-sm sm:px-1.5 sm:text-lg" : "px-1.5 text-lg"}`}
            >
              {label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Condensed, sidebar-friendly positional finishes. Instead of a wide
 * season x scoring table, each season is a compact card that stacks the three
 * scoring finishes (PPR / Half / Std) as small labeled cells, so the whole
 * history reads top-to-bottom in a narrow column. Newest season first. Each card
 * carries an aria-label naming the season so screen readers announce context
 * before the per-format finishes.
 */
export function SeasonFinishesRail({
  position,
  finishes,
  emptyLabel = "No scored seasons on file to compute positional finishes.",
}: {
  position: string;
  finishes: PositionalFinish[];
  emptyLabel?: string;
}) {
  // season -> scoring -> finish
  const bySeason = new Map<number, Map<ScoringKey, PositionalFinish>>();
  for (const f of finishes) {
    let m = bySeason.get(f.season);
    if (!m) {
      m = new Map();
      bySeason.set(f.season, m);
    }
    m.set(f.scoring, f);
  }
  const seasons = Array.from(bySeason.keys()).sort((a, b) => b - a);

  if (seasons.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2.5">
      {seasons.map((season) => {
        const row = bySeason.get(season);
        return (
          <li
            key={season}
            aria-label={`${season} positional finishes`}
            className="rounded-card border border-line bg-surface/60 px-3 py-2.5"
          >
            <p className="mb-2 font-mono text-sm font-semibold tabular-nums text-ink">
              {season}
            </p>
            <dl className="grid grid-cols-3 gap-1.5">
              {SCORING_KEYS.map((s) => {
                const f = row?.get(s.key);
                return (
                  <div
                    key={s.key}
                    className="rounded-md border border-line bg-base/40 px-1.5 py-1.5 text-center"
                  >
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
                      {s.short}
                    </dt>
                    <dd className="mt-1">
                      {f ? (
                        <span
                          className={`inline-flex rounded px-1 font-mono text-sm font-bold tabular-nums ${posClass(
                            position,
                          )}`}
                        >
                          {finishLabel(position, f.finish)}
                        </span>
                      ) : (
                        <span className="font-mono text-sm text-ink-subtle">-</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
