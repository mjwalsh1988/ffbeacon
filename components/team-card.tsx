"use client";

import Link from "next/link";
import { useId, useMemo } from "react";
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
};

const POSITION_ORDER = ["QB", "RB", "WR", "TE"] as const;
type ValuedPosition = (typeof POSITION_ORDER)[number];

const POSITION_LABEL: Record<ValuedPosition, string> = {
  QB: "Quarterbacks",
  RB: "Running Backs",
  WR: "Wide Receivers",
  TE: "Tight Ends",
};

const POSITION_TONE: Record<ValuedPosition, string> = {
  QB: "bg-brand-purple/15 text-brand-purple",
  RB: "bg-brand-cyan/15 text-brand-cyan",
  WR: "bg-signal-positive/15 text-signal-positive",
  TE: "bg-signal-warning/15 text-signal-warning",
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
 * — full roster in one screen on lg viewports, stacks down to a 2-col then
 * 1-col grid for smaller screens. No data is hidden at any breakpoint.
 */
export function TeamCard({
  data,
  sleeperLeagueId,
  showViewTeamPageLink = true,
  headingLevel = "h2",
  expanded: expandedProp,
  onToggleExpand,
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
  } = data;

  const starterSet = useMemo(() => new Set(starterIds), [starterIds]);
  const grouped = useMemo(() => groupByPosition(players, trends), [players, trends]);
  const sortedPicks = useMemo(
    () =>
      [...draftPicks].sort((a, b) =>
        a.season !== b.season ? a.season - b.season : a.round - b.round,
      ),
    [draftPicks],
  );

  const headingId = `team-${sleeperRosterId}-heading`;
  const regionId = useId();

  const HeaderInner = (
    <div className="flex w-full flex-col gap-3 text-left">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <HeadingTag
              id={headingId}
              className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl"
            >
              {teamName}
            </HeadingTag>
            {cacheRow?.overall_rank != null && (
              <span
                className="inline-flex items-center rounded-full bg-brand-purple/15 px-2 py-0.5 text-xs font-semibold text-brand-purple"
                aria-label={`Power ranking ${cacheRow.overall_rank}`}
              >
                #{cacheRow.overall_rank}
              </span>
            )}
          </div>
          {(ownerSleeperUsername || ownerDisplayName) && (
            <p className="mt-0.5 text-xs text-ink-subtle">
              Owner: {ownerDisplayName || `@${ownerSleeperUsername}`}
            </p>
          )}
          <p className="mt-1 font-mono text-xs text-ink-muted">
            {record.wins}-{record.losses}
            {record.ties ? `-${record.ties}` : ""} • {record.pointsFor.toFixed(0)} pts
          </p>
        </div>
        {collapsible && (
          <span
            aria-hidden="true"
            className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-line bg-base text-ink-muted transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          >
            ▼
          </span>
        )}
      </div>
      {cacheRow && (
        <ul
          aria-label="Position rankings"
          className="grid w-full grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3"
        >
          <RankTile label="QB" rank={positionRanks.QB} teamCount={teamCount} count={grouped.QB.length} countLabel="players" />
          <RankTile label="RB" rank={positionRanks.RB} teamCount={teamCount} count={grouped.RB.length} countLabel="players" />
          <RankTile label="WR" rank={positionRanks.WR} teamCount={teamCount} count={grouped.WR.length} countLabel="players" />
          <RankTile label="TE" rank={positionRanks.TE} teamCount={teamCount} count={grouped.TE.length} countLabel="players" />
          <RankTile label="PICKS" rank={statRanks.picks} teamCount={teamCount} count={sortedPicks.length} countLabel="picks" />
          <RankTile label="TOTAL" rank={statRanks.total} teamCount={teamCount} count={null} countLabel="" />
          {/* TODO(transactions phase): add a TRADES rank tile here matching DPC's
            * DynastyDecoderLeagueClient.tsx tradesByRoster computation. Show
            * trades count + league rank, with the same top-3/bottom-3 tier
            * highlight. Blocked until league_transactions ingestion ships. */}
        </ul>
      )}
    </div>
  );

  return (
    <article
      aria-labelledby={headingId}
      id={`team-${sleeperRosterId}`}
      className="rounded-card border border-line bg-surface"
    >
      {/* Header — becomes an expand/collapse button when the parent supplies onToggleExpand */}
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

      {/* Roster + picks — single horizontal grid of columns. Hidden when collapsed. */}
      {expanded && (
        <div
          id={regionId}
          role="region"
          aria-labelledby={headingId}
        >
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:gap-4 sm:p-5 lg:grid-cols-5">
            {POSITION_ORDER.map((pos) => (
              <PositionColumn
                key={pos}
                position={pos}
                players={grouped[pos]}
                starterSet={starterSet}
                totalValue={positionValues[pos]}
                rank={positionRanks[pos]}
                teamCount={teamCount}
              />
            ))}
            <PicksColumn
              picks={sortedPicks}
              ownRosterId={sleeperRosterId}
              rosterIdToTeamName={rosterIdToTeamName}
              rosterIdToOwnerUsername={rosterIdToOwnerUsername}
            />
          </div>

          {/* Footer link */}
          {showViewTeamPageLink && (
            <footer className="border-t border-line p-4 sm:p-5">
              <Link
                href={`/leagues/${sleeperLeagueId}/teams/${sleeperRosterId}`}
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
}: {
  position: ValuedPosition;
  players: ResolvedPlayer[];
  starterSet: Set<string>;
  totalValue: number;
  rank: number | null;
  teamCount: number;
}) {
  const rankLabel = rank != null ? ordinal(rank) : "—";
  const denominator = teamCount > 0 ? ` of ${teamCount}` : "";
  const headerAria =
    rank != null
      ? `${POSITION_LABEL[position]}: ranked ${rankLabel}${denominator}, total value ${formatValue(totalValue)}`
      : `${POSITION_LABEL[position]}: total value ${formatValue(totalValue)}`;
  return (
    <section aria-label={headerAria} className="flex min-w-0 flex-col rounded-card border border-line bg-base">
      <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2">
        <h3 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wider">
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-[0.16em] ${POSITION_TONE[position]}`}>
            {position}
          </span>
          <span className="font-mono text-[11px] text-ink-subtle">
            {rankLabel}
            {denominator}
          </span>
        </h3>
        <p className="font-mono text-xs font-semibold tabular-nums text-ink">
          {formatValue(totalValue)}
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
        <ul className="divide-y divide-line/60">
          {picks.map((p, i) => {
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
            return (
              <li
                key={`${p.season}-${p.round}-${p.original_roster_id}-${i}`}
                className="flex items-baseline gap-2 px-3 py-1.5"
              >
                <span className="flex-shrink-0 font-mono text-sm font-medium text-ink">
                  {p.season} R{p.round}
                </span>
                <span className="ml-auto truncate text-right text-[10px] text-ink-subtle">
                  {attribution}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
  /** Optional secondary count below the rank (e.g. 5 players, 12 picks). null hides the line. */
  count: number | null;
  countLabel: string;
}) {
  const tier = rankTier(rank, teamCount);
  // Inline styles so the colors render even if a build cache or PurgeCSS
  // pass dropped the dynamic Tailwind classes. Each tier maps to the brand
  // tokens documented in plan.md section 2.
  const frameStyle =
    tier === "top"
      ? { borderColor: "rgba(34, 211, 238, 0.55)", backgroundColor: "rgba(34, 211, 238, 0.10)" }
      : tier === "bottom"
        ? { borderColor: "rgba(168, 85, 247, 0.55)", backgroundColor: "rgba(168, 85, 247, 0.10)" }
        : { borderColor: "#1F1F33", backgroundColor: "#07070D" };
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
  const rankLabel = rank != null && teamCount > 0 ? `${ordinal(rank)} of ${teamCount}` : "—";
  return (
    <li
      style={frameStyle}
      className="flex flex-col items-center gap-0.5 rounded-card border px-2 py-2 text-center"
      aria-label={`${label} rank ${rankLabel}${ariaTier}${count != null ? `, ${count} ${countLabel}` : ""}`}
    >
      <span
        className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle"
      >
        {label}
      </span>
      <span
        style={numberStyle}
        className="font-mono text-lg font-extrabold tabular-nums leading-none sm:text-xl"
      >
        {rank != null ? ordinal(rank) : "—"}
      </span>
      {teamCount > 0 && (
        <span className="font-mono text-[9px] tabular-nums text-ink-subtle" aria-hidden="true">
          of {teamCount}
        </span>
      )}
      {count != null && (
        <span className="text-[9px] uppercase tracking-wider text-ink-subtle">
          {count} {countLabel}
        </span>
      )}
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

function formatValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(0);
}
