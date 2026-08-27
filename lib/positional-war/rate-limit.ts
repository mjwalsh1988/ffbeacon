import "server-only";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";

/**
 * The limit on the upgrade what-if (section 15.1.2).
 *
 * A NEW bucket, not the trade-impact bucket. The one-bucket-for-three-paths
 * reasoning in lib/trade-impact/rate-limit.ts is about three entry points
 * into ONE evaluation, so alternating between them cannot buy three budgets.
 * That argument does not transfer here: this is a different feature on a
 * different page, with exactly one entry point (the server action below the
 * Positional WAR chart). Sharing the trade bucket would mean a reader who
 * spent their budget on Trade Ideas walks over here and finds this panel
 * already exhausted, which is a real cost with no security gain.
 * lib/breakdown/league-mode.ts is the existing precedent for a feature owning
 * its own bucket rather than borrowing one that happens to guard similar work.
 *
 * FIVE PER MINUTE, not ten. There is exactly one press per answer: a reader
 * picks a position, presses the button, reads the result. A human cannot want
 * more than a handful of those in a minute; a script reaches five as easily as
 * ten, so the lower number costs nothing real and shrinks the window an
 * automated caller has to work with.
 *
 * CLAIMED AFTER VALIDATION, per the standing rule: shape check the request,
 * then re-derive the viewer's roster from rosters.player_ids rather than
 * trusting a submitted roster id, then claim this slot, then run the
 * simulation. A malformed or spoofed request must not cost a reader their
 * budget, and it must not buy an attacker anything either.
 *
 * Fails closed, in lib/rate-limit-claim.ts: a limiter outage produces a
 * refusal, which is the correct failure direction for a bucket that guards
 * a Monte Carlo season simulation.
 */
export const WAR_UPGRADE_BUCKET = "positional-war-upgrade";
export const WAR_UPGRADE_WINDOW_SECONDS = 60;
export const WAR_UPGRADE_MAX = 5;

/** Claim one slot for the upgrade what-if. Claim after validation, before the simulation. */
export async function claimWarUpgradeSlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: WAR_UPGRADE_BUCKET,
    max: WAR_UPGRADE_MAX,
    windowSeconds: WAR_UPGRADE_WINDOW_SECONDS,
  });
}

/**
 * The cheap outer meter, claimed FIRST and unconditionally.
 *
 * The bucket above is claimed after validation, which is right for a reader who
 * pressed the button on a stale page: a request that fails the roster
 * derivation should not cost them one of their five. But "does not cost the
 * reader" and "does not cost us" are different things. A shaped-but-invalid
 * payload still buys a league lookup and, when the league id resolves, two more
 * indexed reads inside the roster derivation, and none of that is metered.
 * Garbage was the one input that skipped the meter entirely, which is the exact
 * hole a security review found in lib/trade-impact/rate-limit.ts and the reason
 * that module carries two meters instead of one.
 *
 * So this one is claimed before any read at all, and it is loose enough that no
 * real reader will ever reach it: a person picking positions and pressing a
 * button cannot make thirty requests in a minute, and a script hits it
 * immediately. The evaluation meter above still guards the expensive half and
 * still runs after validation, so a stale link still costs a reader nothing
 * from the budget that matters.
 */
export const WAR_UPGRADE_ENTRY_BUCKET = "positional-war-upgrade-entry";
export const WAR_UPGRADE_ENTRY_MAX = 30;

/** The outer meter. Claim before ANY read, on every entry to the action. */
export async function claimWarUpgradeEntrySlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: WAR_UPGRADE_ENTRY_BUCKET,
    max: WAR_UPGRADE_ENTRY_MAX,
    windowSeconds: WAR_UPGRADE_WINDOW_SECONDS,
  });
}
