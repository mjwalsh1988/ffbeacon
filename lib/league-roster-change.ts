/**
 * Has a league's roster state changed since a derived cache was built?
 *
 * Power Pulse and the trade-value rankings are both computed from who owns
 * whom. Their gates used to know only about time (a 12 or 24 hour TTL) and the
 * NFL week, so a trade, a waiver claim or a player moved to injured reserve left
 * both surfaces describing rosters that no longer existed until the clock ran
 * out. The league sync now compares what Sleeper returned with what was stored
 * and stamps `leagues.rosters_changed_at` when they differ; the two gates read
 * that stamp and treat a cache row generated before it as stale.
 *
 * What counts as a change is deliberately narrow: the player list, injured
 * reserve, the taxi squad and who holds which draft pick. A lineup shuffle, a
 * win or a points total moving is not a roster change, and counting it would
 * recompute every league every hour of every Sunday for nothing.
 *
 * Pure and dependency-free so both gates (lib/league-pulse.ts and
 * lib/league-power-pulse.ts) share one copy without an import cycle.
 */

/** The fields of one roster that decide whether it changed. */
export type RosterShape = {
  sleeperRosterId: number;
  playerIds: string[];
  reserveIds: string[];
  taxiIds: string[];
  /** Pick ownership as "season:round:originalRosterId>currentRosterId" keys. */
  picks: string[];
};

/** Pick ownership only. Slot labels are presentation and are ignored. */
export function pickOwnershipKeys(picks: unknown): string[] {
  if (!Array.isArray(picks)) return [];
  const out: string[] = [];
  for (const pick of picks) {
    if (!pick || typeof pick !== "object") continue;
    const p = pick as Record<string, unknown>;
    out.push(`${p.season}:${p.round}:${p.original_roster_id}>${p.current_roster_id}`);
  }
  return out;
}

/** Stored jsonb id lists, read defensively. */
export function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "" && v !== "0");
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  if (seen.size !== new Set(b).size) return false;
  return b.every((x) => seen.has(x));
}

/**
 * True when the rosters Sleeper just returned differ from the stored ones in
 * any way that moves Power Pulse or the trade-value rankings: a roster added or
 * removed, or any roster's players, reserve, taxi squad or pick ownership.
 * Order within a list is ignored.
 */
export function rostersChanged(stored: RosterShape[], next: RosterShape[]): boolean {
  if (stored.length !== next.length) return true;
  const byId = new Map(stored.map((r) => [r.sleeperRosterId, r]));
  for (const r of next) {
    const prior = byId.get(r.sleeperRosterId);
    if (!prior) return true;
    if (!sameSet(prior.playerIds, r.playerIds)) return true;
    if (!sameSet(prior.reserveIds, r.reserveIds)) return true;
    if (!sameSet(prior.taxiIds, r.taxiIds)) return true;
    if (!sameSet(prior.picks, r.picks)) return true;
  }
  return false;
}

/**
 * True when `changedAt` is a real timestamp later than `generatedAt`. Null or
 * unparseable means no change on record, which leaves a gate as it was.
 */
export function changedSince(
  changedAt: string | null | undefined,
  generatedAt: string | null | undefined,
): boolean {
  if (!changedAt || !generatedAt) return false;
  const changed = new Date(changedAt).getTime();
  const generated = new Date(generatedAt).getTime();
  if (Number.isNaN(changed) || Number.isNaN(generated)) return false;
  return changed > generated;
}
