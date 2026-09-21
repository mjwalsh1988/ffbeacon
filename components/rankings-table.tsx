"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { BottomSheet } from "@/components/bottom-sheet";
import { BeaconValue } from "@/components/beacon-value-icon";

export type RankingsRow = {
  overall_rank: number;
  position_rank: number;
  /** POSITIONAL tier from lib/rankings/tiers.ts, computed from the value
   *  cliffs inside this player's own position. Deliberately not the
   *  `rankings.tier` column, which is a percentile sixth of the whole board
   *  (tier 1 ran from rank 1 to rank 102) and told a reader nothing. */
  tier: number | null;
  /** How many players share the tier, so the badge can say how deep it is. */
  tierSize?: number | null;
  /** True for the best player in the tier, the one just past a cliff. */
  startsTier?: boolean;
  /** Value drop to the next player at the SAME position, which is the number
   *  that answers "does waiting a round cost me anything". */
  gapToNext?: number | null;
  gapToNextPct?: number | null;
  /** True when that next player is a tier down, so this gap IS the cliff. */
  opensNextTier?: boolean;
  slug: string;
  /** Sleeper player id from players.external_ids.sleeper. Drives the
   * small headshot circle next to the player name. */
  sleeper_id: string | null;
  name: string;
  position: string;
  team: string | null;
  status: string;
  value: number | null;
  /* THE BOARD'S MOVEMENT COLUMNS ARE 30-DAY, BOTH OF THEM, and no 7-day field
     reaches this component at all as of 2026-09-21. A week of rank movement
     was a column of plus-or-minus one on nearly every row, and a week of value
     movement was the noise around whichever single piece of news happened to
     land. A month is a direction, which is the thing a reader can act on.
     The week survives only in the Market movers panel, as a top-five list,
     where a big move is news rather than a column of nothing. */
  change_30d_pct: number | null;
  trend_30d: string | null;
  rank_change_30d: number | null;
  /** Per-window bookend gate from player_value_trends. True when the source
   *  has a data point near both ends of the 30-day window. */
  show_trend_30d: boolean;
  /** Highest and lowest value over the last 30 days, shown in the detail
   *  sheet so a reader can see whether today's number is a peak or a trough. */
  high_30d: number | null;
  low_30d: number | null;
  /** Resolved source cadence (same for every row in one table). Drives the
   *  "updated weekly" note so a weekly trend is not misread as daily-fresh. */
  cadence?: "daily" | "weekly";
};

type SortKey =
  | "overall_rank"
  | "position_rank"
  | "name"
  | "position"
  | "team"
  | "tier"
  | "value"
  | "gapToNext"
  | "rank_change_30d"
  | "change_30d_pct";
type SortDir = "asc" | "desc";

// The 30-day trend display is gated by row.show_trend_30d (computed in
// calculate-trends.ts via the cadence-aware bookend rule): show movement only
// when the source has a data point near both ends of the 30-day window.

type Column = { key: SortKey; label: string; numeric: boolean };
type MobileSortOption = {
  key: SortKey;
  label: string;
  short: string;
  defaultDir: SortDir;
};

// Desktop columns. Mobile renders a different layout (Rank, Player, dynamic
// metric column driven by the active sort chip) so it does not consume this
// list, see buildMobileSortOptions below.
//
// On the overall board the primary "Rank" column is the overall rank. On a
// positional board (a position filter is active) the primary "Rank" column
// switches to the positional rank (RB1, RB2... shown as 1, 2...) so the reader
// sees "which RB is this" at a glance, and a dedicated "OVR Rank" column is
// added right after it to preserve the overall rank. The redundant "Pos rank"
// column is dropped on positional boards because the primary Rank already
// carries that number.
function buildColumns(positional: boolean): Column[] {
  if (positional) {
    return [
      { key: "position_rank", label: "Rank", numeric: true },
      { key: "overall_rank", label: "OVR Rank", numeric: true },
      { key: "name", label: "Player", numeric: false },
      { key: "team", label: "Team", numeric: false },
      { key: "position", label: "Pos", numeric: false },
      { key: "tier", label: "Tier", numeric: true },
      { key: "value", label: "Value", numeric: true },
      { key: "gapToNext", label: "Gap", numeric: true },
      { key: "rank_change_30d", label: "Rank 30d", numeric: true },
      { key: "change_30d_pct", label: "Value 30d", numeric: true },
    ];
  }
  return [
    { key: "overall_rank", label: "Rank", numeric: true },
    { key: "name", label: "Player", numeric: false },
    { key: "team", label: "Team", numeric: false },
    { key: "position", label: "Pos", numeric: false },
    { key: "position_rank", label: "Pos rank", numeric: true },
    { key: "tier", label: "Tier", numeric: true },
    { key: "value", label: "Value", numeric: true },
    { key: "gapToNext", label: "Gap", numeric: true },
    { key: "rank_change_30d", label: "Rank 30d", numeric: true },
    { key: "change_30d_pct", label: "Value 30d", numeric: true },
  ];
}

// Mobile sort chip row. Each chip both selects the sort key AND determines
// which metric the dynamic third column on mobile renders. Tap the active
// chip again to flip the sort direction; tap an inactive chip to switch
// metrics (resets direction to the chip's natural default, Rank low→high,
// values/trends high→low). On a positional board the "Rank" chip sorts by the
// positional rank; the "Pos rank" chip is dropped because Rank already is it.
function buildMobileSortOptions(positional: boolean): MobileSortOption[] {
  if (positional) {
    return [
      { key: "position_rank", label: "Rank", short: "Rank", defaultDir: "asc" },
      { key: "value", label: "Value", short: "Value", defaultDir: "desc" },
      { key: "tier", label: "Tier", short: "Tier", defaultDir: "asc" },
      { key: "gapToNext", label: "Gap", short: "Gap", defaultDir: "desc" },
      { key: "rank_change_30d", label: "Rank 30d", short: "Rank 30d", defaultDir: "desc" },
      { key: "change_30d_pct", label: "Value 30d", short: "Val 30d", defaultDir: "desc" },
    ];
  }
  return [
    { key: "overall_rank", label: "Rank", short: "Rank", defaultDir: "asc" },
    { key: "value", label: "Value", short: "Value", defaultDir: "desc" },
    { key: "tier", label: "Tier", short: "Tier", defaultDir: "asc" },
    { key: "position_rank", label: "Pos rank", short: "Pos #", defaultDir: "asc" },
    { key: "gapToNext", label: "Gap", short: "Gap", defaultDir: "desc" },
    { key: "rank_change_30d", label: "Rank 30d", short: "Rank 30d", defaultDir: "desc" },
    { key: "change_30d_pct", label: "Value 30d", short: "Val 30d", defaultDir: "desc" },
  ];
}

export function RankingsTable({
  rows,
  valueIsBeacon = false,
  positionFilter = null,
}: {
  rows: RankingsRow[];
  /** True when the source backing the Value column is FF Beacon. Drives the
   *  small FF Beacon mark shown to the left of every value number so readers
   *  recognize the proprietary values as ours. */
  valueIsBeacon?: boolean;
  /** Active position filter (e.g. "RB"), or null on the overall board. When
   *  set, the primary Rank column shows the positional rank and an "OVR Rank"
   *  column carries the overall rank. The parent keys this component on the
   *  position so the default sort re-initializes on each position switch. */
  positionFilter?: string | null;
}) {
  const positional = Boolean(positionFilter);
  const columns = useMemo(() => buildColumns(positional), [positional]);
  const mobileSortOptions = useMemo(
    () => buildMobileSortOptions(positional),
    [positional],
  );
  const [sortKey, setSortKey] = useState<SortKey>(
    positional ? "position_rank" : "overall_rank",
  );
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [openRow, setOpenRow] = useState<RankingsRow | null>(null);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      // Undefined is normalized to null before the comparison below. The
      // newer columns are optional on RankingsRow (a caller that has not been
      // updated still type-checks), so an absent field arrives as undefined
      // and would otherwise skip the numeric branch and be string-compared.
      const va = a[sortKey] ?? null;
      const vb = b[sortKey] ?? null;
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Mobile chip-row sort handler. Tapping the active chip flips direction;
  // tapping an inactive chip switches the active metric and resets to that
  // chip's natural default direction (Rank ascending, values/trends
  // descending, the "best first" intent for each metric).
  const handleMobileSort = (key: SortKey, defaultDir: SortDir) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  };

  return (
    <>
      {/* Mobile-only sort chip row. Each chip flips both the sort AND the
          dynamic third column on the table below, so users always see the
          metric they're sorting by. */}
      <div className="mb-3 rounded-card border border-line bg-surface p-3 md:hidden">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
          Sort by
        </p>
        <div
          role="radiogroup"
          aria-label="Sort rankings by"
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {mobileSortOptions.map((opt) => {
            const isActive = opt.key === sortKey;
            return (
              <button
                key={`${opt.key}-${opt.label}`}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => handleMobileSort(opt.key, opt.defaultDir)}
                className={`inline-flex min-h-11 flex-shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? "border-brand-purple bg-brand-purple/15 text-ink"
                    : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
                }`}
                aria-label={
                  isActive
                    ? `Sort by ${opt.label}, currently ${sortDir === "asc" ? "ascending" : "descending"}. Tap to flip direction.`
                    : `Sort by ${opt.label}. Tap to activate.`
                }
              >
                <span>{opt.short}</span>
                {isActive && (
                  <span aria-hidden="true">
                    {sortDir === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Player rankings. Sortable by rank, name, team, position, tier, value, the
            gap to the next player at the same position, 30-day rank movement, and
            30-day value change. Tier is worked out from the value cliffs inside each
            position, so a tier of two and a tier of eleven are both normal. Gap is how
            far the value falls to the next player at the same position. Movement is
            measured over 30 days, because a week barely moves a rank. On mobile, tap a
            player row for full details.
          </caption>
          {/* ONE thead, TWO header rows, one per breakpoint.
              These were two separate <thead> elements until 2026-09-21, which
              is invalid: a table gets exactly one. A thead may hold as many
              rows as it likes, so the split moves down a level and the markup
              becomes legal without either layout changing. Whichever row the
              breakpoint hides is display:none, so assistive tech is offered
              exactly one header row, the same as before. */}
          <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            {/* Desktop. Hidden on mobile because the chip row above and the
                compact 3-column body handle sort + columns differently. */}
            <tr className="hidden md:table-row">
              {columns.map((col, idx) => {
                const isActive = col.key === sortKey;
                const isFirst = idx === 0;
                const isLast = idx === columns.length - 1;
                const sortAttr: "ascending" | "descending" | "none" = isActive
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none";
                // Player is the only column that anchors left; everything
                // numeric reads better centered now that the rank column
                // owns the leftmost slot.
                const align = col.numeric
                  ? "text-center"
                  : col.key === "name"
                    ? "text-left"
                    : "text-center";
                const sidePad = isFirst ? "pl-4" : isLast ? "pr-4" : "";
                const widthHint =
                  col.key === "overall_rank" || col.key === "position_rank"
                    ? "w-16"
                    : "";
                return (
                  <th
                    key={`${col.key}-${idx}`}
                    scope="col"
                    aria-sort={sortAttr}
                    className={`px-3 py-3 ${align} ${sidePad} ${widthHint}`.trim()}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(col.key)}
                      className={`inline-flex min-h-[44px] items-center gap-1 hover:text-ink ${
                        col.numeric ? "justify-center" : ""
                      }`}
                    >
                      <span>{col.label}</span>
                      {isActive ? (
                        <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>
                      ) : (
                        <span aria-hidden="true" className="text-ink-subtle">
                          ⇅
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>

            {/* Mobile (Rank, Player, dynamic metric). Renders only below md
                and reflects the active mobile sort chip in the third cell. */}
            <tr className="md:hidden">
              <th scope="col" className="w-14 py-3 pl-4 pr-2 text-center">
                Rank
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                Player
              </th>
              <th scope="col" className="py-3 pl-2 pr-4 text-center">
                {mobileMetricLabel(sortKey, mobileSortOptions, positional)}
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {sorted.map((row) => (
              <tr key={row.slug} className="hover:bg-surface">
                <td className="w-14 py-3 pl-4 pr-2 text-center font-mono tabular-nums text-ink-muted md:w-16 md:px-3">
                  {positional ? row.position_rank : row.overall_rank}
                  {positional && (
                    <span className="mt-0.5 block text-[10px] leading-tight text-ink-subtle md:hidden">
                      OVR {row.overall_rank}
                    </span>
                  )}
                </td>
                {positional && (
                  <td className="hidden w-16 px-3 py-3 text-center font-mono tabular-nums text-ink-muted md:table-cell">
                    {row.overall_rank}
                  </td>
                )}
                <td className="px-3 py-3 text-left">
                  {/* Mobile: tap-to-open sheet. Desktop: link to full player profile. */}
                  <button
                    type="button"
                    onClick={() => setOpenRow(row)}
                    aria-haspopup="dialog"
                    aria-label={`Open details for ${row.name}`}
                    className="flex w-full items-center gap-2.5 text-left md:hidden"
                  >
                    <PlayerHeadshot
                      sleeperId={row.sleeper_id}
                      position={row.position}
                      name={row.name}
                      size={32}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">
                        {row.name}
                      </span>
                      {row.status !== "active" && (
                        <span
                          className="mt-0.5 inline-flex rounded bg-signal-warning/15 px-1.5 py-0.5 text-[10px] uppercase text-signal-warning"
                          aria-label={`Injury status: ${row.status}`}
                        >
                          {row.status}
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="hidden items-center gap-2.5 md:flex">
                    <PlayerHeadshot
                      sleeperId={row.sleeper_id}
                      position={row.position}
                      name={row.name}
                      size={32}
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/players/${row.slug}`}
                        className="font-medium text-ink hover:text-brand-purple"
                      >
                        {row.name}
                      </Link>
                      {row.status !== "active" && (
                        <span
                          className="ml-2 rounded bg-signal-warning/15 px-1.5 py-0.5 text-xs uppercase text-signal-warning"
                          aria-label={`Injury status: ${row.status}`}
                        >
                          {row.status}
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* Mobile dynamic metric cell, renders only at <md. */}
                <td className="py-3 pl-2 pr-4 text-center font-mono tabular-nums md:hidden">
                  <MobileMetricCell
                    row={row}
                    sortKey={sortKey}
                    valueIsBeacon={valueIsBeacon}
                    positional={positional}
                  />
                </td>

                {/* Desktop-only cells. */}
                <td className="hidden px-3 py-3 text-center text-ink-muted md:table-cell">
                  {row.team ?? "-"}
                </td>
                <td className="hidden px-3 py-3 text-center md:table-cell">
                  <span className="font-mono text-xs text-brand-cyan">{row.position}</span>
                </td>
                {!positional && (
                  <td className="hidden px-3 py-3 text-center font-mono tabular-nums text-ink-muted md:table-cell">
                    {row.position}
                    {row.position_rank}
                  </td>
                )}
                <td className="hidden px-3 py-3 text-center md:table-cell">
                  <TierCell row={row} />
                </td>
                <td className="hidden px-3 py-3 text-center font-mono tabular-nums md:table-cell">
                  {row.value !== null ? (
                    <BeaconValue show={valueIsBeacon}>
                      {row.value.toLocaleString("en-US")}
                    </BeaconValue>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="hidden px-2.5 py-3 text-center font-mono tabular-nums md:table-cell">
                  <GapCell row={row} />
                </td>
                <td className="hidden px-2.5 py-3 text-center font-mono tabular-nums md:table-cell">
                  <span className="inline-flex justify-center">
                    <RankTrendCell row={row} />
                  </span>
                </td>
                <td className="hidden py-3 pl-2.5 pr-4 text-center font-mono tabular-nums md:table-cell">
                  <span className="inline-flex justify-center">
                    <ValueTrendCell row={row} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PlayerDetailSheet
        row={openRow}
        onClose={() => setOpenRow(null)}
        valueIsBeacon={valueIsBeacon}
      />
    </>
  );
}

/**
 * Which metric the mobile table's third column actually renders.
 *
 * ONE FUNCTION DECIDES, and both the header and the cell ask it. They used to
 * decide separately and disagreed: sorting by Rank put "Rank" in the header
 * while the cell fell through to the value, because the rank already lives in
 * the left-hand column and repeating it would waste the only metric slot a
 * phone has. Every sort key that has no metric of its own to show lands on
 * "value" here, so the header can never name a column the body is not
 * rendering.
 */
function mobileMetricKey(sortKey: SortKey, positional: boolean): SortKey {
  if (sortKey === "tier") return "tier";
  if (sortKey === "gapToNext") return "gapToNext";
  if (sortKey === "rank_change_30d") return "rank_change_30d";
  if (sortKey === "change_30d_pct") return "change_30d_pct";
  // On a positional board the "Pos rank" chip is dropped and the "Rank" chip
  // sorts by position_rank, which the left Rank column already shows.
  if (sortKey === "position_rank" && !positional) return "position_rank";
  return "value";
}

function mobileMetricLabel(
  sortKey: SortKey,
  options: MobileSortOption[],
  positional: boolean,
): string {
  const key = mobileMetricKey(sortKey, positional);
  const opt = options.find((o) => o.key === key);
  // "value" always has a chip, so the fallback is unreachable in practice and
  // is here only so a future chip list that drops it still names something.
  return opt?.label ?? "Value";
}

/**
 * The tier badge.
 *
 * The number means something now: it is the player's tier inside his OWN
 * position, cut at the value cliffs (lib/rankings/tiers.ts), not the
 * percentile sixth of the whole board the database column holds. A reader
 * cannot see that from "T2" alone, so the size of the tier and the fact that
 * it is positional both live in the accessible name, and the first player in
 * each tier takes a cyan ring so the cliffs are visible down the column
 * without reading a single number.
 */
function TierCell({ row }: { row: RankingsRow }) {
  if (row.tier === null) {
    return (
      <span className="text-ink-subtle">
        -<span className="sr-only">No tier, no value published for this player</span>
      </span>
    );
  }
  const size = row.tierSize ?? null;
  const depth =
    size === null
      ? ""
      : `, ${size} ${size === 1 ? "player" : "players"} in it`;
  const top = row.startsTier ? ", top of the tier" : "";
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs ${
        row.startsTier
          ? "bg-brand-cyan/10 text-brand-cyan ring-1 ring-inset ring-brand-cyan/40"
          : "bg-surface-elevated"
      }`}
    >
      T{row.tier}
      <span className="sr-only">{`, ${row.position}${depth}${top}`}</span>
    </span>
  );
}

/**
 * The drop in value to the next player at the same position.
 *
 * This is the scarcity number, and it is the one a draft board is really
 * asking about: a run of small gaps means the position is deep and waiting
 * costs nothing, one large gap means the next man down is a real step
 * backwards. It is per POSITION, never to the next row on screen, because the
 * receiver sitting between two running backs is not a choice anybody faces.
 *
 * A gap that IS a tier boundary is toned, so the cliffs stand out down the
 * column, and it is the same boundary the tier ring marks rather than a
 * percentage threshold of its own. Those were two different rules once, and
 * they disagreed in both directions: a pass-two tier cut lands on whatever the
 * steepest step in an over-wide run happens to be, which is often well under
 * ten percent, and a ten percent step that fails the minimum-gap floor opens
 * no tier at all. The column was highlighting gaps no ring marked and leaving
 * ringed rows plain.
 *
 * The fact is spoken as well as toned, since colour is not information a
 * screen reader or a colour-blind reader receives.
 */
function GapCell({ row }: { row: RankingsRow }) {
  const gap = row.gapToNext ?? null;
  if (gap === null) {
    return (
      <span className="text-ink-subtle">
        -
        <span className="sr-only">{`Last ranked ${row.position} on this board, no next player to fall to`}</span>
      </span>
    );
  }
  const pct = row.gapToNextPct ?? null;
  const isCliff = Boolean(row.opensNextTier) && gap > 0;
  const pctWords = pct === null ? "" : `, a ${pct.toFixed(1)} percent drop`;
  return (
    <span className={isCliff ? "font-semibold text-brand-cyan" : "text-ink-muted"}>
      {Math.round(gap).toLocaleString("en-US")}
      <span className="sr-only">{` points clear of the next ${row.position}${pctWords}${isCliff ? ", the drop into the next tier" : ""}`}</span>
    </span>
  );
}

function MobileMetricCell({
  row,
  sortKey,
  valueIsBeacon,
  positional,
}: {
  row: RankingsRow;
  sortKey: SortKey;
  valueIsBeacon: boolean;
  positional: boolean;
}) {
  // The same decision the header made, so the two cannot drift apart.
  switch (mobileMetricKey(sortKey, positional)) {
    case "tier":
      return <TierCell row={row} />;
    case "gapToNext":
      return <GapCell row={row} />;
    case "rank_change_30d":
      return <RankTrendCell row={row} />;
    case "change_30d_pct":
      return <ValueTrendCell row={row} />;
    case "position_rank":
      return (
        <span className="text-ink">
          {row.position}
          {row.position_rank}
        </span>
      );
    default:
      return row.value !== null ? (
        <BeaconValue show={valueIsBeacon}>
          {row.value.toLocaleString("en-US")}
        </BeaconValue>
      ) : (
        <span>-</span>
      );
  }
}

/**
 * Mobile bottom-sheet that surfaces every column from the desktop table
 * (team, position, tier, value, the gap to the next player at the position,
 * 30-day rank movement and 30-day value movement) plus the 30-day range,
 * which the desktop table has no room for, and a CTA to the full player
 * profile. Satisfies the mobile-first rule: data hidden from the mobile table
 * is still reachable here, and this sheet is the ONE place on the board that
 * shows the 30-day high and low.
 */
function PlayerDetailSheet({
  row,
  onClose,
  valueIsBeacon,
}: {
  row: RankingsRow | null;
  onClose: () => void;
  valueIsBeacon: boolean;
}) {
  const open = row !== null;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label={row ? `${row.name} details` : "Player details"}
      showClose={false}
    >
      {row && (
        <>
          <header className="flex items-start gap-3 px-5 pt-4">
            <PlayerHeadshot
              sleeperId={row.sleeper_id}
              position={row.position}
              name={row.name}
              size={56}
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold tracking-tight text-ink">
                {row.name}
              </h2>
              <p className="truncate text-xs text-ink-subtle">
                {row.position}
                {row.team ? `, ${row.team}` : ""}
                {row.position_rank ? `, ${row.position}#${row.position_rank}` : ""}
              </p>
              {row.status !== "active" && (
                <span
                  className="mt-1 inline-flex rounded bg-signal-warning/15 px-1.5 py-0.5 text-[10px] uppercase text-signal-warning"
                  aria-label={`Injury status: ${row.status}`}
                >
                  {row.status}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close player details"
              className="-mr-1 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </header>

          <section
            aria-label="Player metrics"
            className="grid grid-cols-2 gap-2 px-5 pt-5"
          >
            <MetricTile label="Overall rank" value={`#${row.overall_rank}`} />
            <MetricTile
              label={`${row.position} rank`}
              value={`#${row.position_rank}`}
            />
            <MetricTile label="Tier" value={<TierCell row={row} />} />
            <MetricTile
              label="Value"
              value={
                row.value !== null ? (
                  <BeaconValue show={valueIsBeacon}>
                    {row.value.toLocaleString("en-US")}
                  </BeaconValue>
                ) : (
                  "-"
                )
              }
            />
            <MetricTile label="Gap to next" value={<GapCell row={row} />} />
            <MetricTile label="Rank 30d" value={<RankTrendCell row={row} />} />
            <MetricTile label="Value 30d" value={<ValueTrendCell row={row} />} />
            {/* The 30-day range has no column on the desktop table, so this
                is where it lives. It answers the question the percentage
                cannot: is today's number a peak, a trough, or the middle of
                a quiet month. */}
            {row.high_30d !== null &&
              row.high_30d !== undefined &&
              row.low_30d !== null &&
              row.low_30d !== undefined && (
                <div className="col-span-2 rounded-card border border-line bg-base/60 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                    30-day range
                  </p>
                  <p className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                    {Math.round(row.low_30d).toLocaleString("en-US")} to{" "}
                    {Math.round(row.high_30d).toLocaleString("en-US")}
                    {row.value !== null && (
                      <span className="ml-2 text-xs font-normal text-ink-muted">
                        now {row.value.toLocaleString("en-US")}
                      </span>
                    )}
                  </p>
                </div>
              )}
          </section>

          <div className="mt-5 flex flex-col gap-2 px-5">
            <Link
              href={`/players/${row.slug}`}
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center rounded-card bg-beacon px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              View full profile →
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-surface px-4 py-3 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink"
            >
              Close
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-base/60 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </p>
      <p className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

/**
 * HOW EVERY FIGURE IN THIS TABLE IS NARRATED, and why it is not an aria-label.
 *
 * These cells used to be a `<span aria-label="Moved up 3 positions">` wrapping
 * an `<span aria-hidden="true">3</span>`. Two things are wrong with that.
 * `aria-label` is only honoured on elements with a widget or structural role,
 * and a bare `<span>` has neither, so the label was liable to be dropped and
 * the only remaining text was hidden: the cell could read as empty. And even
 * where it was honoured, hiding the visible number means a reader who points
 * at it finds nothing and falls back to an ancestor.
 *
 * So every figure below is ONE REAL TEXT NODE, never hidden, with only the
 * words a sighted reader gets from the arrow and the column header appended
 * as `sr-only` INSIDE THE SAME ELEMENT. The arrow icons stay `aria-hidden`,
 * because they are decoration whose meaning is in those words. Same rule the
 * Lineups board follows, and for the same reason.
 */
function RankTrendCell({ row }: { row: RankingsRow }) {
  const cadenceNote = row.cadence === "weekly" ? ", updated weekly" : "";
  const title = row.cadence === "weekly" ? "Updated weekly" : undefined;

  if (!row.show_trend_30d || row.rank_change_30d === null) {
    return (
      <span className="text-ink-subtle">
        -<span className="sr-only">No 30-day rank movement, not enough history</span>
      </span>
    );
  }
  const change = row.rank_change_30d;
  if (change === 0) {
    return (
      <span className="text-ink-muted" title={title}>
        -
        <span className="sr-only">
          No rank change over the last 30 days{cadenceNote}
        </span>
      </span>
    );
  }
  const isUp = change > 0;
  const tone = isUp ? "text-signal-positive" : "text-signal-warning";
  const Icon = isUp ? ArrowUp : ArrowDown;
  const places = Math.abs(change);
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 ${tone}`}
      title={title}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {places}
      <span className="sr-only">
        {` ${places === 1 ? "place" : "places"} ${isUp ? "gained" : "lost"} over the last 30 days${cadenceNote}`}
      </span>
    </span>
  );
}

/**
 * Percentage value movement over the last 30 days.
 *
 * A month rather than a week, deliberately: a week is whichever single piece
 * of news happened to land, and it reverses about as often as it holds. The
 * week still has a home in the Market movers panel, where a top-five list is
 * news; as a column over every row it was noise.
 *
 * `show_trend_30d` off renders a dash rather than a zero, because "no data
 * near both ends of the window" is not the same claim as "the price held".
 */
function ValueTrendCell({ row }: { row: RankingsRow }) {
  const cadenceNote = row.cadence === "weekly" ? ", updated weekly" : "";
  const title = row.cadence === "weekly" ? "Updated weekly" : undefined;

  if (!row.show_trend_30d || row.change_30d_pct === null || row.trend_30d === null) {
    return (
      <span className="text-ink-subtle">
        -<span className="sr-only">No 30-day value trend, not enough history</span>
      </span>
    );
  }
  const pct = row.change_30d_pct;
  if (row.trend_30d === "stable" || pct === 0) {
    // "Stable" can include a small non-zero pct (within the trend threshold).
    // The visible number is the real one either way, so the spoken figure and
    // the printed figure are the same text node.
    const pctText = pct === 0 ? "0.0%" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    return (
      <span className="text-ink-muted" title={title}>
        {pctText}
        <span className="sr-only">
          {pct === 0
            ? ` no value change over the last 30 days${cadenceNote}`
            : ` value change over the last 30 days, roughly steady${cadenceNote}`}
        </span>
      </span>
    );
  }
  const isUp = pct > 0;
  const tone = isUp ? "text-signal-positive" : "text-signal-warning";
  const Icon = isUp ? ArrowUp : ArrowDown;
  const pctText = `${isUp ? "+" : ""}${pct.toFixed(1)}%`;
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 ${tone}`}
      title={title}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {pctText}
      <span className="sr-only">
        {` value ${isUp ? "gained" : "lost"} over the last 30 days${cadenceNote}`}
      </span>
    </span>
  );
}
