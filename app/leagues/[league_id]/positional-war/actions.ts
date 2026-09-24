"use server";

import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveSleeperViewer } from "@/lib/sleeper-handle/resolve";
import { loadPositionalWarView } from "@/lib/league-positional-war-data";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import {
  claimWarUpgradeEntrySlot,
  claimWarUpgradeSlot,
} from "@/lib/positional-war/rate-limit";
import {
  resolveUpgradeViewerRoster,
  runUpgradeWhatIf,
  type UpgradeWhatIfOutcome,
} from "@/lib/positional-war/upgrade";

/**
 * The one entry point for the upgrade what-if.
 *
 * There is no second path into this work. Trade Ideas needs one bucket shared
 * across three entry points (the action, the server-rendered `?mode=build`
 * page path, and the streamed suggestion) because a reader could otherwise
 * alternate between them to buy extra budget. Nothing here has a URL that
 * encodes an upgrade request, so there is no server-rendered path to meter and
 * no second entry point to share a bucket with. This action, pressed from
 * components/league-war/upgrade-panel.tsx, is the whole surface.
 *
 * THE ORDER OF THE FOUR GATES IS THE POINT, per section 15.1.2:
 *
 *   1. Shape. A zod parse, no database read. Rejects a malformed payload for
 *      free, before anything is spent on it (E1b-3).
 *   1b. A cheap outer meter, claimed unconditionally before any read, so a
 *      caller sending shaped garbage in a loop cannot spend our database for
 *      nothing. Deliberately loose: no real reader reaches it.
 *   2. Re-derive whose team the viewer actually owns, from rosters.player_ids,
 *      never from the roster id the payload carries. A payload naming a
 *      roster id the derivation did not itself produce is refused outright
 *      (E1b-2), not silently corrected to the derived one: silently swapping
 *      teams would answer a question that was not asked.
 *   3. Claim the rate-limit slot. Only now, because gates 1 and 2 are free and
 *      a malformed or spoofed request must not cost a reader their budget.
 *   4. Simulate, in lib/positional-war/upgrade.ts runUpgradeWhatIf.
 */

// Any position a curve can exist for. A defensive curve exists only once the
// IDP switch is on in a league that starts defenders (plan IDP-309). Gate 2b
// below refuses a position with no stored curve BEFORE the slot is claimed, so
// a crafted DL request against any other league spends nothing.
const POSITION_PATTERN = z.enum(PULSE_POSITIONS as unknown as [PulsePosition, ...PulsePosition[]]);

const requestSchema = z.object({
  sleeperLeagueId: z.string().regex(/^[0-9]{1,32}$/),
  position: POSITION_PATTERN,
  submittedRosterId: z.number().int().min(0).max(1000),
  searchedUsername: z.string().trim().min(1).max(64).nullable(),
  focusedRosterId: z.number().int().min(0).max(1000).nullable(),
});

export type UpgradeWhatIfRequestInput = z.infer<typeof requestSchema>;

export async function requestUpgradeWhatIf(raw: unknown): Promise<UpgradeWhatIfOutcome> {
  // Gate 1: shape. No database read, no rate-limit slot spent.
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "invalid" };
  }
  const input = parsed.data;

  // Gate 1b: the cheap outer meter, claimed before ANY read.
  //
  // Gate 3 below is claimed after validation, which is right for the reader: a
  // stale page should not cost them one of their five. But a shaped-but-invalid
  // payload still buys the league lookup and the two reads inside gate 2, and
  // without this those are free to a caller sending garbage in a loop. Loose
  // enough that a person pressing a button cannot reach it, tight enough that a
  // script does immediately. Same two-meter shape, and the same reason, as
  // lib/trade-impact/rate-limit.ts.
  const entryAllowed = await claimWarUpgradeEntrySlot();
  if (!entryAllowed) {
    return { ok: false, reason: "rate-limited" };
  }

  const admin = createAdminClient();

  // Resolve the league row id once, ahead of gate 2, so the viewer
  // re-derivation and the computation both work from the same row without a
  // second lookup. Not itself a simulation: a single-row read by a unique key.
  const { data: leagueRow } = await admin
    .from("leagues")
    .select("id, season")
    .eq("sleeper_league_id", input.sleeperLeagueId)
    .maybeSingle();
  if (!leagueRow || leagueRow.season == null) {
    return { ok: false, reason: "league-not-found" };
  }

  // Gate 2: re-derive the viewer's roster. A forged or stale submittedRosterId
  // is refused here, before any rate-limit slot is spent.
  //
  // The Sleeper user id comes from the READER'S OWN SESSION, never from the
  // payload. A saved handle is a Sleeper username and league_users carries
  // display names, so the id is the only exact match; taking one off the wire
  // would hand a caller the ability to name any roster and have this gate
  // agree with them.
  const sessionViewer = await resolveSleeperViewer(
    await createClient(),
    input.searchedUsername ?? undefined,
  );
  const viewer = await resolveUpgradeViewerRoster(admin, {
    leagueRowId: leagueRow.id,
    submittedRosterId: input.submittedRosterId,
    searchedUsername: input.searchedUsername,
    viewerSleeperUserId: sessionViewer?.sleeperUserId ?? null,
    focusedRosterId: input.focusedRosterId,
  });
  if (!viewer.ok) {
    return { ok: false, reason: viewer.reason };
  }

  // Gate 2b: a stored curve for the position. Free for the reader, and the
  // read is the request-memoised one runUpgradeWhatIf repeats, so it costs no
  // second query. Without it a position with no curve (every defensive one
  // while the IDP switch is off) would claim a slot and then be refused.
  const view = await loadPositionalWarView(admin, leagueRow.id, Number(leagueRow.season));
  const curve = view?.curves.find((c) => c.position === input.position) ?? null;
  if (!curve || curve.curve.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }

  // Gate 3: the rate-limit slot. Fails closed: an outage refuses rather than
  // allows, which is the correct direction for a bucket guarding a Monte Carlo
  // season simulation.
  const allowed = await claimWarUpgradeSlot();
  if (!allowed) {
    return { ok: false, reason: "rate-limited" };
  }

  // Gate 4: the simulation.
  return runUpgradeWhatIf(admin, {
    sleeperLeagueId: input.sleeperLeagueId,
    position: input.position,
    rosterId: viewer.rosterId,
  });
}
