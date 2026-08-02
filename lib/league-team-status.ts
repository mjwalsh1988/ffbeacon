/**
 * Where a team sits on the compete-or-rebuild axis, as one word.
 *
 * Two numbers already exist for every synced team and they answer different
 * questions. Power Pulse says how many games a roster should win from here.
 * The trade-value rank says how much it owns. A team can be high on one and low
 * on the other, and that gap is the whole story:
 *
 *   - Competitor: near the top by Power Pulse. It wins now, whatever it owns.
 *   - Rebuilder: not winning now, and either holding more value than it can
 *     start or sitting at the bottom of the league with nothing to lean on.
 *   - Middle of the pack: in the pack on both counts.
 *
 * Ranks are turned into percentiles first, because a 6th-place finish means
 * something different in an eight-team league than in a sixteen. Percentile 1
 * is the top of the league, 0 is the bottom.
 *
 * Power Pulse leads and value follows. A team that wins now is a competitor
 * even if its roster is cheap, which is why value never pulls a team out of the
 * Competitor band. Value only decides whether a team that is NOT winning is
 * rebuilding with assets or just short on everything, and both of those answer
 * to Rebuilder.
 *
 * Pure. No database, no React. The batched read that feeds the league list
 * lives in lib/league-team-status-data.ts.
 */

export type TeamStatusKey = "competitor" | "middle" | "rebuilder";

export type TeamStatus = {
  key: TeamStatusKey;
  /** Full label. Used everywhere there is room. */
  label: string;
  /** Short label for tight columns and chips. */
  short: string;
  /** One sentence saying why this team landed here. Feeds aria-label and title. */
  reason: string;
};

/** Top of this band by Power Pulse and the team is competing. */
const COMPETITOR_FLOOR = 0.65;
/** Bottom of this band by Power Pulse and there is nothing to compete for. */
const REBUILD_CEILING = 0.35;
/**
 * How far a team's value percentile has to sit above its Power Pulse
 * percentile before the gap itself is the story. 0.15 of a twelve-team league
 * is a little under two full places, so a team ranked 6th by Pulse needs to be
 * roughly 4th or better by value to read as a rebuild rather than the middle.
 */
const DIVERGENCE_GAP = 0.15;

const LABELS: Record<TeamStatusKey, { label: string; short: string }> = {
  competitor: { label: "Competitor", short: "Compete" },
  middle: { label: "Middle of the pack", short: "Middle" },
  rebuilder: { label: "Rebuilder", short: "Rebuild" },
};

/** 1 for the best rank in the league, 0 for the worst. */
function percentile(rank: number, teamCount: number): number {
  if (teamCount <= 1) return 0.5;
  const clamped = Math.min(Math.max(rank, 1), teamCount);
  return (teamCount - clamped) / (teamCount - 1);
}

export function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function build(key: TeamStatusKey, reason: string): TeamStatus {
  return { key, ...LABELS[key], reason };
}

/**
 * Classify one team. Returns null when there is no Power Pulse rank to read,
 * which is the "not synced yet" case every surface renders differently.
 *
 * `valueRank` is optional on purpose: a league whose format no source covers
 * still gets a Competitor / Rebuilder call from Power Pulse alone.
 */
export function classifyTeamStatus({
  pulseRank,
  valueRank,
  teamCount,
}: {
  pulseRank: number | null | undefined;
  valueRank: number | null | undefined;
  teamCount: number;
}): TeamStatus | null {
  if (pulseRank == null || !Number.isFinite(pulseRank)) return null;
  if (!Number.isFinite(teamCount) || teamCount < 2) return null;

  const pulsePct = percentile(pulseRank, teamCount);
  const valuePct =
    valueRank != null && Number.isFinite(valueRank)
      ? percentile(valueRank, teamCount)
      : null;

  const place = `${ordinal(pulseRank)} of ${teamCount} by Power Pulse`;

  if (pulsePct >= COMPETITOR_FLOOR) {
    return build("competitor", `${place}, so this roster is built to win now.`);
  }

  if (valuePct !== null && valuePct - pulsePct >= DIVERGENCE_GAP) {
    return build(
      "rebuilder",
      `${place} but ${ordinal(valueRank as number)} by value, so the assets are ahead of the wins.`,
    );
  }

  if (pulsePct <= REBUILD_CEILING) {
    return build(
      "rebuilder",
      valuePct !== null
        ? `${place} and ${ordinal(valueRank as number)} by value, with no edge on either side of the ledger.`
        : `${place}, near the bottom of the league.`,
    );
  }

  return build(
    "middle",
    valuePct !== null
      ? `${place} and ${ordinal(valueRank as number)} by value, in the pack on both counts.`
      : `${place}, in the pack.`,
  );
}
