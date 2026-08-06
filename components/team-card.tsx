"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { BeaconValue } from "@/components/beacon-value-icon";
import { formatValue } from "@/lib/format-value";
import { PlayerHeadshot } from "@/components/player-headshot";
import { TeamStatusBadge } from "@/components/team-status-badge";
import type { TeamStatus } from "@/lib/league-team-status";
import { POSITION_BADGE } from "@/lib/on-the-clock/position-colors";
import type {
  DraftPickAsset,
  ResolvedPlayer,
  TeamCardData,
  TrendLite,
} from "@/lib/league-view-data";

type TeamCardProps = {
  data: TeamCardData;
  sleeperLeagueId: string;
  /** When true (default), render the "View team page" link in the expanded footer. Set false on the team detail page so the card doesn't link to itself. */
  showViewTeamPageLink?: boolean;
  /** Heading level for the team name. Use h2 on the league inline view (where the page h1 is the league title) and h1 on the team detail page. */
  headingLevel?: "h1" | "h2" | "h3";
  /** Whether the roster body is currently visible. Defaults to true when no toggle handler is supplied (single-team detail page). */
  expanded?: boolean;
  /** Provided by TeamFilter on the league inline view. Omit to render a non-collapsible card. */
  onToggleExpand?: () => void;
  /** Forwarded from `?username=` so the "View team page" link keeps the
   * in-view league switcher context on the team detail page. */
  searchedUsername?: string | null;
  /** True when the league's selected value source is FF Beacon, so each
   * position subtotal renders with the FF Beacon mark. */
  valueIsBeacon?: boolean;
  /** Competitor / Mid Tier / Rebuilder for this roster. Null before
   * Power Pulse has run for the league, and on pre-draft leagues where there
   * is nothing to judge yet. */
  teamStatus?: TeamStatus | null;
};

const POSITION_ORDER = ["QB", "RB", "WR", "TE"] as const;
type ValuedPosition = (typeof POSITION_ORDER)[number];

const POSITION_LABEL: Record<ValuedPosition, string> = {
  QB: "Quarterbacks",
  RB: "Running Backs",
  WR: "Wide Receivers",
  TE: "Tight Ends",
};

// Colored top edge per position group, matching the On The Clock draft board
// hues (QB red, RB green, WR blue, TE amber). Full literal class strings so
// Tailwind's content scanner keeps them. The position pill itself uses the
// shared POSITION_BADGE tokens (lib/on-the-clock/position-colors) so roster
// colors track the draft board exactly.
const POSITION_ACCENT: Record<ValuedPosition, string> = {
  QB: "border-t-2 border-position-qb/70",
  RB: "border-t-2 border-position-rb/70",
  WR: "border-t-2 border-position-wr/70",
  TE: "border-t-2 border-position-te/70",
};

/**
 * TeamCard: one team's full roster + value breakdown rendered inline.
 * Used by both /leagues/[id] (Teams tab, many TeamCards stacked) and
 * /leagues/[id]/teams/[roster_id] (detail page, one TeamCard).
 *
 * When `onToggleExpand` is provided, the header acts as an expand/collapse
 * button. Collapsed state shows only the header (team identity + totals)
 * so multiple teams can be lined up at a glance. Expanded state shows the
 * roster as a horizontal grid of position columns (QB, RB, WR, TE, Picks)
 *, full roster in one screen on lg viewports, stacks down to a 2-col then
 * 1-col grid for smaller screens. No data is hidden at any breakpoint.
 */
export function TeamCard({
  data,
  sleeperLeagueId,
  showViewTeamPageLink = true,
  headingLevel = "h2",
  expanded: expandedProp,
  onToggleExpand,
  searchedUsername = null,
  valueIsBeacon = false,
  teamStatus = null,
}: TeamCardProps) {
  const HeadingTag = headingLevel;
  const collapsible = typeof onToggleExpand === "function";
  const expanded = collapsible ? expandedProp ?? false : expandedProp ?? true;

  const {
    sleeperRosterId,
    teamName,
    ownerSleeperUsername,
    ownerDisplayName,
    record,
    cacheRow,
    players,
    trends,
    draftPicks,
    starterIds,
    rosterIdToTeamName,
    rosterIdToOwnerUsername,
    positionValues,
    positionRanks,
    teamCount,
    statRanks,
    includePicks,
    displayOverallRank,
  } = data;

  const starterSet = useMemo(() => new Set(starterIds), [starterIds]);
  const grouped = useMemo(() => groupByPosition(players, trends), [players, trends]);
  const sortedPicks = useMemo(
    () =>
      [...draftPicks].sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        if (a.round !== b.round) return a.round - b.round;
        const slotA = a.slot ?? Number.MAX_SAFE_INTEGER;
        const slotB = b.slot ?? Number.MAX_SAFE_INTEGER;
        if (slotA !== slotB) return slotA - slotB;
        return (a.original_roster_id ?? 0) - (b.original_roster_id ?? 0);
      }),
    [draftPicks],
  );

  const headingId = `team-${sleeperRosterId}-heading`;
  const regionId = useId();

  // Shared segmented-strip styling for the two stat panels: a brighter outline
  // and a soft beacon glow so they read as focused, elevated units. Full width
  // on mobile, content-sized inline on desktop.
  const statStrip =
    "flex w-full items-stretch divide-x divide-line/70 overflow-hidden rounded-card border border-line-accent bg-base/70 shadow-[0_0_22px_-10px_rgba(168,85,247,0.6)] sm:inline-flex sm:w-auto";

  const HeaderInner = (
    <div className="relative flex w-full items-center gap-3 text-left">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3">
        {/* Left: power-rank badge + team identity, vertically centered together.
            flex-1 so it grows and pushes the stat panels to the right on desktop.
            On mobile it reserves room for the absolutely-positioned toggle. */}
        <div
          className={`flex min-w-0 flex-1 items-center gap-3 ${
            collapsible ? "pr-9 sm:pr-0" : ""
          }`}
        >
          {displayOverallRank != null && (
            <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-card border border-brand-purple/40 bg-brand-purple/10 shadow-[0_0_18px_-8px_rgba(168,85,247,0.7)]">
              <span className="sr-only">Power ranking {displayOverallRank}</span>
              <span
                aria-hidden="true"
                className="text-[7px] font-bold uppercase tracking-[0.14em] text-brand-purple/70"
              >
                Rank
              </span>
              <span
                aria-hidden="true"
                className="font-mono text-lg font-extrabold leading-none text-brand-purple"
              >
                {displayOverallRank}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <HeadingTag
              id={headingId}
              className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl"
            >
              {teamName}
            </HeadingTag>
            {(ownerSleeperUsername || ownerDisplayName) && (
              <p className="mt-0.5 truncate text-xs text-ink-subtle">
                Owner: {ownerDisplayName || `@${ownerSleeperUsername}`}
              </p>
            )}
            {teamStatus && (
              <span className="mt-1.5 block">
                <TeamStatusBadge status={teamStatus} size="sm" />
              </span>
            )}
          </div>
        </div>

        {/* Right: the two stat panels. Full width and stacked on mobile (they
            span the whole card since the toggle is floated out of flow);
            content-sized inline on desktop, pushed right by the flex-1 identity. */}
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto sm:flex-nowrap">
          {/* Record & performance. */}
          <dl aria-label="Record and performance" className={statStrip}>
            <StatCell
              label="Record"
              value={`${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ""}`}
            />
            <StatCell label="Points" value={record.pointsFor.toFixed(0)} />
          </dl>

          {/* Positional + total ranks (top-3 cyan / bottom-3 purple highlight). */}
          {cacheRow && (
            <ul aria-label="Position rankings" className={statStrip}>
              <RankTile label="QB" rank={positionRanks.QB} teamCount={teamCount} count={grouped.QB.length} countLabel="players" />
              <RankTile label="RB" rank={positionRanks.RB} teamCount={teamCount} count={grouped.RB.length} countLabel="players" />
              <RankTile label="WR" rank={positionRanks.WR} teamCount={teamCount} count={grouped.WR.length} countLabel="players" />
              <RankTile label="TE" rank={positionRanks.TE} teamCount={teamCount} count={grouped.TE.length} countLabel="players" />
              {includePicks && (
                <RankTile label="PICKS" rank={statRanks.picks} teamCount={teamCount} count={sortedPicks.length} countLabel="picks" />
              )}
              <RankTile label="TOTAL" rank={statRanks.total} teamCount={teamCount} count={null} countLabel="" />
              {/* TODO(transactions phase): add a TRADES rank chip here once
                * league_transactions ingestion ships (trades count + league rank
                * with the same top-3/bottom-3 tier highlight). */}
            </ul>
          )}
        </div>
      </div>

      {collapsible && (
        // Floated to the top-right on mobile so the full-width stat panels below
        // aren't shortened by it; back in the flow (centered) on desktop.
        <span
          aria-hidden="true"
          className={`absolute right-0 top-0 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-base text-ink-muted transition-transform sm:static ${
            expanded ? "rotate-180" : ""
          }`}
        >
          ▼
        </span>
      )}
    </div>
  );

  return (
    <article
      aria-labelledby={headingId}
      id={`team-${sleeperRosterId}`}
      className="rounded-card border border-line bg-surface"
    >
      {/* Header, becomes an expand/collapse button when the parent supplies onToggleExpand */}
      <header className={collapsible ? "" : "border-b border-line p-4 sm:p-5"}>
        {collapsible ? (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-controls={regionId}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${teamName} roster`}
            className={`w-full p-4 text-left text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:p-5 ${
              expanded ? "border-b border-line" : "rounded-card"
            }`}
          >
            {HeaderInner}
          </button>
        ) : (
          HeaderInner
        )}
      </header>

      {/* Roster + picks, single horizontal grid of columns. Hidden when collapsed. */}
      {expanded && (
        <div
          id={regionId}
          role="region"
          aria-labelledby={headingId}
        >
          <div
            className={`grid gap-3 p-4 sm:grid-cols-2 sm:gap-4 sm:p-5 ${
              includePicks ? "lg:grid-cols-5" : "lg:grid-cols-4"
            }`}
          >
            {POSITION_ORDER.map((pos) => (
              <PositionColumn
                key={pos}
                position={pos}
                players={grouped[pos]}
                starterSet={starterSet}
                totalValue={positionValues[pos]}
                rank={positionRanks[pos]}
                teamCount={teamCount}
                valueIsBeacon={valueIsBeacon}
              />
            ))}
            {includePicks && (
              <PicksColumn
                picks={sortedPicks}
                ownRosterId={sleeperRosterId}
                rosterIdToTeamName={rosterIdToTeamName}
                rosterIdToOwnerUsername={rosterIdToOwnerUsername}
              />
            )}
          </div>

          {/* Footer link */}
          {showViewTeamPageLink && (
            <footer className="border-t border-line p-4 sm:p-5">
              <Link
                href={
                  searchedUsername
                    ? `/leagues/${sleeperLeagueId}/teams/${sleeperRosterId}?username=${encodeURIComponent(searchedUsername)}`
                    : `/leagues/${sleeperLeagueId}/teams/${sleeperRosterId}`
                }
                className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 py-2 text-sm font-medium text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                aria-label={`Open dedicated page for ${teamName}`}
              >
                View team page
                <span aria-hidden="true">→</span>
              </Link>
            </footer>
          )}
        </div>
      )}
    </article>
  );
}

// ---------- subcomponents ----------

function PositionColumn({
  position,
  players,
  starterSet,
  totalValue,
  rank,
  teamCount,
  valueIsBeacon,
}: {
  position: ValuedPosition;
  players: ResolvedPlayer[];
  starterSet: Set<string>;
  totalValue: number;
  rank: number | null;
  teamCount: number;
  valueIsBeacon: boolean;
}) {
  const rankLabel = rank != null ? ordinal(rank) : "-";
  const denominator = teamCount > 0 ? ` of ${teamCount}` : "";
  const headerAria =
    rank != null
      ? `${POSITION_LABEL[position]}: ranked ${rankLabel}${denominator}, total value ${formatValue(totalValue)}`
      : `${POSITION_LABEL[position]}: total value ${formatValue(totalValue)}`;
  return (
    <section
      aria-label={headerAria}
      className={`flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-base ${POSITION_ACCENT[position]}`}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <h3 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider">
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-[0.16em] ${POSITION_BADGE[position]}`}>
            {position}
          </span>
          <span className="font-mono text-[11px] text-ink-subtle">
            {rankLabel}
            {denominator}
          </span>
        </h3>
        <p className="font-mono text-xs font-semibold tabular-nums text-ink">
          <BeaconValue show={valueIsBeacon}>{formatValue(totalValue)}</BeaconValue>
        </p>
      </header>
      {players.length === 0 ? (
        <p className="px-3 py-3 text-xs italic text-ink-subtle">No {position}s</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {players.map((p) => {
            const starter = starterSet.has(p.id);
            return (
              <li
                key={p.id}
                className="flex items-center gap-2 px-3 py-1.5"
              >
                {/* Decorative headshot: the name text beside it is the label. */}
                <span aria-hidden="true" className="shrink-0">
                  <PlayerHeadshot
                    sleeperId={p.sleeper_id}
                    name=""
                    position={p.position}
                    size={26}
                    className="ring-1 ring-inset ring-white/10"
                  />
                </span>
                <span
                  className="truncate text-sm font-medium text-ink"
                  title={p.full_name}
                >
                  {p.full_name}
                </span>
                <span
                  className="flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-subtle"
                  aria-label={`Team ${p.team ?? "free agent"}`}
                >
                  {p.team ?? "FA"}
                </span>
                {starter && (
                  <span
                    className="ml-auto flex-shrink-0 inline-flex items-center rounded-full bg-brand-cyan/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand-cyan"
                    aria-label="Starter"
                  >
                    ST
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const PICKS_COLLAPSED_MAX = 5;

function PicksColumn({
  picks,
  ownRosterId,
  rosterIdToTeamName,
  rosterIdToOwnerUsername,
}: {
  picks: DraftPickAsset[];
  ownRosterId: number;
  rosterIdToTeamName: Record<number, string>;
  rosterIdToOwnerUsername: Record<number, string | null>;
}) {
  // Show the first few picks by default; reveal the rest on demand so a deep
  // pick stash doesn't run the roster card long. Mirrors On The Clock.
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const canToggle = picks.length > PICKS_COLLAPSED_MAX;
  const visible = expanded || !canToggle ? picks : picks.slice(0, PICKS_COLLAPSED_MAX);
  const hiddenCount = picks.length - visible.length;

  return (
    <section
      aria-label="Draft picks"
      className="flex min-w-0 flex-col rounded-card border border-line bg-base"
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <h3 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider">
          <span className="rounded-md bg-ink/10 px-1.5 py-0.5 text-[11px] font-bold tracking-[0.16em] text-ink">
            PICKS
          </span>
        </h3>
        <p className="font-mono text-[11px] text-ink-subtle">
          {picks.length} pick{picks.length === 1 ? "" : "s"}
        </p>
      </header>
      {picks.length === 0 ? (
        <p className="px-3 py-3 text-xs italic text-ink-subtle">No picks</p>
      ) : (
        <>
          <ul id={listId} className="divide-y divide-line/60">
          {visible.map((p, i) => {
            const isOwn = p.original_roster_id === ownRosterId;
            // Prefer the Sleeper username over team_name for attribution.
            // Falls through to team name, then numeric roster id if neither resolved.
            const username = !isOwn ? rosterIdToOwnerUsername[p.original_roster_id] : null;
            const teamFallback = !isOwn
              ? rosterIdToTeamName[p.original_roster_id] ?? `Team ${p.original_roster_id}`
              : null;
            const attribution = isOwn
              ? "Own pick"
              : username
                ? `via @${username}`
                : `via ${teamFallback}`;
            const pickLabel = p.pick_label
              ? `${p.season} R${p.pick_label}`
              : `${p.season} R${p.round}`;
            return (
              <li
                key={`${p.season}-${p.round}-${p.original_roster_id}-${i}`}
                className="flex items-baseline gap-2 px-3 py-1.5"
              >
                <span
                  className="flex-shrink-0 font-mono text-sm font-medium text-ink"
                  aria-label={
                    p.pick_label
                      ? `${p.season} round ${p.round}, slot ${p.slot}`
                      : `${p.season} round ${p.round}`
                  }
                >
                  {pickLabel}
                </span>
                <span className="ml-auto truncate text-right text-[10px] text-ink-subtle">
                  {attribution}
                </span>
              </li>
            );
          })}
          </ul>
          {canToggle && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls={listId}
              className="flex min-h-11 items-center justify-center gap-1 border-t border-line px-3 py-2 text-xs font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {expanded ? (
                <>
                  Show less
                  <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  Show {hiddenCount} more
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** One label/value cell of the Record & performance segmented panel. Stretches
 *  to fill on mobile (flex-1) and sizes to content inline on desktop. */
function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 sm:flex-none">
      <dt className="text-[9px] font-bold uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="font-mono text-sm font-bold leading-none tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function RankTile({
  label,
  rank,
  teamCount,
  count,
  countLabel,
}: {
  label: string;
  rank: number | null;
  teamCount: number;
  /** Secondary count (e.g. 5 players, 12 picks), surfaced in the aria-label. */
  count: number | null;
  countLabel: string;
}) {
  const tier = rankTier(rank, teamCount);
  // Inline styles so the tier colors survive a PurgeCSS pass. Each tier maps to
  // the brand tokens documented in plan.md section 2. Only the standouts get a
  // wash; mid cells stay on the strip's own background.
  const cellStyle =
    tier === "top"
      ? { backgroundColor: "rgba(34, 211, 238, 0.10)" }
      : tier === "bottom"
        ? { backgroundColor: "rgba(168, 85, 247, 0.10)" }
        : undefined;
  const numberStyle =
    tier === "top"
      ? { color: "#22D3EE" }
      : tier === "bottom"
        ? { color: "#A855F7" }
        : { color: "#F4F4F8" };
  const ariaTier =
    tier === "top"
      ? " (top three in league)"
      : tier === "bottom"
        ? " (bottom three in league)"
        : "";
  const rankFull = rank != null && teamCount > 0 ? `${ordinal(rank)} of ${teamCount}` : "unranked";
  // One cell of the segmented stat bar: a stacked label + rank. Top/bottom-three
  // cells get a faint tier wash so strong/weak spots pop; the rank number
  // carries the tier color. Full "of N" + count detail lives in the aria-label.
  return (
    <li
      style={cellStyle}
      className="flex flex-1 flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 sm:flex-none"
      aria-label={`${label} rank ${rankFull}${ariaTier}${count != null ? `, ${count} ${countLabel}` : ""}`}
    >
      <span className="text-[9px] font-bold uppercase tracking-wider text-ink-subtle">
        {label}
      </span>
      <span
        style={numberStyle}
        className="font-mono text-sm font-bold tabular-nums leading-none"
      >
        {rank != null ? ordinal(rank) : "-"}
      </span>
    </li>
  );
}

function rankTier(rank: number | null, teamCount: number): "top" | "bottom" | "mid" | "unknown" {
  if (rank == null || teamCount === 0) return "unknown";
  if (rank <= 3) return "top";
  if (rank > teamCount - 3) return "bottom";
  return "mid";
}

// ---------- helpers ----------

function groupByPosition(
  players: ResolvedPlayer[],
  trends: Record<string, TrendLite>,
): Record<ValuedPosition, ResolvedPlayer[]> {
  const grouped: Record<ValuedPosition, ResolvedPlayer[]> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
  };
  for (const p of players) {
    if (p.position in grouped) {
      grouped[p.position as ValuedPosition].push(p);
    }
  }
  for (const pos of POSITION_ORDER) {
    grouped[pos].sort(
      (a, b) => (trends[b.id]?.current_value ?? 0) - (trends[a.id]?.current_value ?? 0),
    );
  }
  return grouped;
}

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}
