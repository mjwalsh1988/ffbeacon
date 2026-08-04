"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Medal, Sparkles, TrendingDown, Trophy } from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import {
  summarizeProjections,
  type ProjectedLeague,
  type ProjectionInput,
} from "@/lib/league-projections";

/**
 * Where this manager is projected to finish, everywhere at once.
 *
 * Best finish first, so the panel opens on the leagues worth defending and ends
 * on the ones worth rebuilding. Only leagues we hold a Power Pulse row for can
 * be ranked; the rest are counted at the bottom rather than guessed at, because
 * an unsynced league has no projection and inventing a middling one would put a
 * team on this list that nobody has ever calculated.
 *
 * Nothing here starts a sync.
 */
export function LeagueProjectionsPanel({
  open,
  onClose,
  inputs,
  sleeperUsername,
}: {
  open: boolean;
  onClose: () => void;
  inputs: ProjectionInput[];
  /** Forwarded on the league links so the deep view defaults to this roster. */
  sleeperUsername: string | null;
}) {
  // The panel stays mounted while closed so it can animate in, so this would
  // otherwise re-sort and re-bucket every league on every parent render.
  const summary = useMemo(() => summarizeProjections(inputs), [inputs]);
  const { leagues, unrankedCount } = summary;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="lg"
      title="Projected finishes"
      subtitle={
        leagues.length > 0
          ? `${leagues.length} ranked ${leagues.length === 1 ? "league" : "leagues"}, best finish first`
          : "No ranked leagues yet"
      }
    >
      {leagues.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="1st" value={summary.first} tone="gold" />
            <Stat label="2nd" value={summary.second} tone="silver" />
            <Stat label="3rd" value={summary.third} tone="bronze" />
            <Stat
              label="Bottom third"
              value={summary.bottomThird}
              tone="plain"
            />
          </dl>

          {summary.anecdote && (
            <p className="mt-4 flex items-start gap-2.5 rounded-card border border-brand-purple/40 bg-brand-purple/10 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
              <Sparkles
                aria-hidden="true"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-purple"
              />
              <span>{summary.anecdote}</span>
            </p>
          )}

          <ul role="list" className="mt-5 space-y-2">
            {leagues.map((league) => (
              <LeagueRow
                key={league.sleeperLeagueId}
                league={league}
                sleeperUsername={sleeperUsername}
              />
            ))}
          </ul>

          {unrankedCount > 0 && (
            <p className="mt-4 rounded-card border border-line bg-base/50 px-3 py-2 text-xs leading-relaxed text-ink-muted">
              {unrankedCount} more{" "}
              {unrankedCount === 1 ? "league has" : "leagues have"} no
              projection yet, usually because nobody has synced{" "}
              {unrankedCount === 1 ? "it" : "them"} or the schedule is not out.
              They appear here once they are calculated.
            </p>
          )}
        </>
      )}
    </SidePanel>
  );
}

/* ---------- pieces ---------- */

const MEDAL_TONE: Record<string, string> = {
  gold: "border-signal-warning/50 bg-signal-warning/10 text-signal-warning",
  silver: "border-ink-muted/50 bg-ink-muted/10 text-ink",
  bronze: "border-[#C77B3A]/60 bg-[#C77B3A]/10 text-[#E09B5A]",
  plain: "border-line bg-base/60 text-ink-muted",
};

/**
 * One podium count.
 *
 * The trophy takes its colour from the tile's own tone class through
 * currentColor, so gold, silver, and bronze cannot drift apart from the boxes
 * around them: there is one place a tone is defined and both the border and the
 * icon read it.
 *
 * Decorative, hence aria-hidden. The label ("1st") and the number already say
 * everything the trophy says, and a screen reader announcing "trophy" before
 * each one would be three words of nothing per tile.
 *
 * The bottom-third tile gets a falling arrow rather than no icon at all. Leaving
 * it bare would put its number on a different baseline from the other three and
 * read as an oversight, and a fourth trophy would be a lie.
 */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: keyof typeof MEDAL_TONE;
}) {
  const Icon = tone === "plain" ? TrendingDown : Trophy;
  return (
    <div className={`rounded-card border px-3 py-2.5 ${MEDAL_TONE[tone]}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-80">
        {label}
      </dt>
      <dd className="mt-1 flex items-center gap-2">
        <Icon aria-hidden="true" className="h-7 w-7 shrink-0" />
        <span className="font-mono text-2xl font-bold leading-none tabular-nums">
          {value}
        </span>
      </dd>
    </div>
  );
}

/**
 * One league, as a link to its deep view.
 *
 * The finish leads the accessible name because that is what the list is sorted
 * on and what the reader came for; the league name follows. A medal on the top
 * three matches the trophy the league list already puts on the same finishes.
 */
function LeagueRow({
  league,
  sleeperUsername,
}: {
  league: ProjectedLeague;
  sleeperUsername: string | null;
}) {
  const { projectedSeed, rankedTeamCount } = league;
  const medal =
    projectedSeed === 1
      ? "gold"
      : projectedSeed === 2
        ? "silver"
        : projectedSeed === 3
          ? "bronze"
          : null;

  const params = new URLSearchParams();
  if (sleeperUsername) params.set("username", sleeperUsername);
  params.set("name", league.leagueName);
  const href = `/leagues/${league.sleeperLeagueId}?${params.toString()}`;

  return (
    <li>
      <Link
        href={href}
        aria-label={`${ordinal(projectedSeed)} of ${rankedTeamCount} in ${league.leagueName}${league.statusLabel ? `, ${league.statusLabel}` : ""}. Open this league.`}
        className="flex items-center gap-3 rounded-card border border-line bg-base/40 px-3 py-2.5 transition-colors hover:border-line-accent hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-9 w-11 shrink-0 items-center justify-center gap-1 rounded-full border font-mono text-xs font-bold tabular-nums ${
            medal
              ? MEDAL_TONE[medal]
              : "border-line-accent bg-surface text-ink-muted"
          }`}
        >
          {medal && <Medal className="h-3 w-3 shrink-0" />}
          {projectedSeed}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {league.leagueName}
          </span>
          <span className="mt-0.5 block text-[11px] text-ink-subtle">
            {ordinal(projectedSeed)} of {rankedTeamCount}
            {league.statusLabel ? `, ${league.statusLabel}` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="rounded-card border border-dashed border-line bg-base/40 p-5">
      <p className="text-sm font-semibold text-ink">No projections yet.</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        A projected finish comes from Power Pulse, which only runs for leagues
        that have been synced. Press Sync all, or open a league, and its finish
        appears here. Opening this panel never starts a sync on its own.
      </p>
    </div>
  );
}

/** 1st, 2nd, 3rd, 4th. Handles the 11th-to-13th exception. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
