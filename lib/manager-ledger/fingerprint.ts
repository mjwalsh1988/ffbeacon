/**
 * The exact invalidation key for a computed ledger.
 *
 * Pure and clock-free, so the same league in the same state produces the same
 * key forever, and a change to any input the model actually reads produces a
 * different one on the very next page view rather than at the end of the TTL.
 *
 * WHAT IS IN IT, AND WHY EACH ONE IS
 *   season               a different season is a different ledger
 *   gradedWeeks          the count AND the highest, so a newly settled week
 *                        invalidates and so does a week that settled late and
 *                        filled a gap behind the leader
 *   rosterCount          a league that added or lost a team ranks differently
 *   slots                the sorted startable tokens, because they decide both
 *                        what the optimal lineup is and which slots are gradable
 *   transactionCount     a trade or claim landing changes three of four ledgers
 *   draftPickCount       picks arrive after the draft is captured, once
 *   modelVersion         a change to the arithmetic
 *
 * WHAT IS DELIBERATELY ABSENT
 *   `source` and `format_config_id`. This model has no value source: every
 *   figure is points scored under the league's own scoring. Including either
 *   would make the source toggle throw away a correct cache for an identical
 *   recomputation. Same reasoning as lib/positional-war/fingerprint.ts.
 *
 *   Also absent: scoring_settings. A commissioner who changes scoring midway
 *   does not retroactively rescore the weeks Sleeper has already settled, and
 *   this model reads Sleeper's own settled points rather than rescoring
 *   anything, so a scoring change cannot move a number in here.
 */

import { createHash } from "node:crypto";
import { MANAGER_LEDGER_MODEL_VERSION } from "./default-settings";

export type LedgerFingerprintInput = {
  season: number;
  gradedWeekCount: number;
  latestGradedWeek: number;
  rosterCount: number;
  slots: string[];
  transactionCount: number;
  draftPickCount: number;
  modelVersion: string;
};

/** The human-readable inputs, for a diagnostic that is not an opaque hash. */
export function ledgerInputsDigest(
  input: Omit<LedgerFingerprintInput, "modelVersion">,
): LedgerFingerprintInput {
  return { ...input, modelVersion: MANAGER_LEDGER_MODEL_VERSION };
}

export function ledgerFingerprint(input: LedgerFingerprintInput): string {
  const payload = [
    `season=${input.season}`,
    `weeks=${input.gradedWeekCount}`,
    `latest=${input.latestGradedWeek}`,
    `rosters=${input.rosterCount}`,
    // Sorted so two leagues with the same slots in a different order produce
    // the same key. The ORDER matters to the alignment of Sleeper's starters
    // array but not to what the optimal lineup can be, and the alignment is
    // rebuilt from roster_positions on every run rather than read from here.
    `slots=${[...input.slots].sort().join(",")}`,
    `tx=${input.transactionCount}`,
    `picks=${input.draftPickCount}`,
    `model=${input.modelVersion}`,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}
