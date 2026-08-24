/**
 * Where a team sits on the compete-or-rebuild axis, as one word.
 *
 * Two numbers already exist for every synced team and they answer different
 * questions. Power Pulse says how many games a roster should win from here.
 * The trade-value rank says how much it owns. A team can be high on one and low
 * on the other, and that gap is the whole story:
 *
 *   - Contender: near the top by Power Pulse. It wins now, whatever it owns.
 *   - Rebuilder (Longshot in a one-year league): not winning now, and either
 *     holding more value than it can start or sitting at the bottom of the
 *     league with nothing to lean on.
 *   - Bubble: in the pack on both counts.
 *
 * Ranks are turned into percentiles first, because a 6th-place finish means
 * something different in an eight-team league than in a sixteen. Percentile 1
 * is the top of the league, 0 is the bottom.
 *
 * Power Pulse leads and value follows. A team that wins now is a contender
 * even if its roster is cheap, which is why value never pulls a team out of the
 * Contender band. Value only decides whether a team that is NOT winning is
 * rebuilding with assets or just short on everything, and both of those answer
 * to the same key.
 *
 * WORDS VERSUS KEYS
 *   `TeamStatusKey` is the logic. It never changes with the league, so sorting,
 *   filtering, and the trade engine all key off it. `variant` only changes the
 *   words: a redraft manager cannot rebuild, because there is nothing to hold
 *   the assets for, so the same third band reads Longshot there. Keeper leagues
 *   take the dynasty wording, since a keeper roster does carry forward.
 *
 * Pure. No database, no React. The batched read that feeds the league list
 * lives in lib/league-team-status-data.ts.
 */

export type TeamStatusKey = "competitor" | "middle" | "rebuilder";

/**
 * Which vocabulary a league gets. "dynasty" covers keeper leagues too, and is
 * the default everywhere the caller has no league in hand.
 */
export type TeamStatusVariant = "dynasty" | "redraft";

export type TeamStatus = {
  key: TeamStatusKey;
  /** Which vocabulary produced the words below. */
  variant: TeamStatusVariant;
  /** Full label. Used everywhere there is room. */
  label: string;
  /** Short label for tight columns and chips. */
  short: string;
  /**
   * The label in a form that survives an indefinite article, for prose like
   * "they read as a ___". Same word as `label` except for the middle band,
   * where "a Bubble" is not a sentence and "a Bubble team" is.
   */
  phrase: string;
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

type Words = { label: string; short: string; phrase: string };

const LABELS: Record<TeamStatusVariant, Record<TeamStatusKey, Words>> = {
  dynasty: {
    competitor: { label: "Contender", short: "Contend", phrase: "Contender" },
    middle: { label: "Bubble", short: "Bubble", phrase: "Bubble team" },
    rebuilder: { label: "Rebuilder", short: "Rebuild", phrase: "Rebuilder" },
  },
  redraft: {
    competitor: { label: "Contender", short: "Contend", phrase: "Contender" },
    middle: { label: "Bubble", short: "Bubble", phrase: "Bubble team" },
    // Nothing carries over, so there is no rebuild to be in the middle of. What
    // is left is a team that needs the season to break its way.
    rebuilder: { label: "Longshot", short: "Longshot", phrase: "Longshot" },
  },
};

/** The words one band gets in one kind of league. */
export function teamStatusWords(
  key: TeamStatusKey,
  variant: TeamStatusVariant = "dynasty",
): Words {
  return LABELS[variant][key];
}

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

function build(
  key: TeamStatusKey,
  variant: TeamStatusVariant,
  reason: string,
): TeamStatus {
  return { key, variant, ...LABELS[variant][key], reason };
}

/**
 * Classify one team. Returns null when there is no Power Pulse rank to read,
 * which is the "not synced yet" case every surface renders differently.
 *
 * `valueRank` is optional on purpose: a league whose format no source covers
 * still gets a Contender / Rebuilder call from Power Pulse alone.
 *
 * `variant` only picks the wording. Every threshold below is the same in a
 * redraft league as in a dynasty one.
 */
export function classifyTeamStatus({
  pulseRank,
  valueRank,
  teamCount,
  variant = "dynasty",
}: {
  pulseRank: number | null | undefined;
  valueRank: number | null | undefined;
  teamCount: number;
  variant?: TeamStatusVariant;
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
    return build(
      "competitor",
      variant,
      `${place}, so this roster is built to win now.`,
    );
  }

  if (valuePct !== null && valuePct - pulsePct >= DIVERGENCE_GAP) {
    return build(
      "rebuilder",
      variant,
      `${place} but ${ordinal(valueRank as number)} by value, so the assets are ahead of the wins.`,
    );
  }

  if (pulsePct <= REBUILD_CEILING) {
    return build(
      "rebuilder",
      variant,
      valuePct !== null
        ? `${place} and ${ordinal(valueRank as number)} by value, with no edge on either side of the ledger.`
        : `${place}, near the bottom of the league.`,
    );
  }

  return build(
    "middle",
    variant,
    valuePct !== null
      ? `${place} and ${ordinal(valueRank as number)} by value, in the pack on both counts.`
      : `${place}, in the pack.`,
  );
}
