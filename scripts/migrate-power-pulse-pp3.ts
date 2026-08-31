/**
 * One-time settings migration: advance the stored Power Pulse row to pp-3.
 *
 * WHY A SCRIPT AND NOT A MIGRATION
 * `mergePowerPulseSettings` layers the stored row OVER the code defaults, so a
 * stored value wins. That is the point: the model is admin-editable without a
 * deploy. The side effect is that a developer changing a code default has no
 * effect at all once anyone has opened /admin/power-pulse and pressed save,
 * because saving persists the whole document including the fields nobody
 * touched.
 *
 * That is what happened. The row written on 2026-08-25 is a byte-for-byte echo
 * of the pp-2 code defaults, `modelVersion` included, so shipping pp-3 without
 * this would have been completely inert: the new measured variance figures
 * overridden by the old estimates, and the version bump that invalidates every
 * cached score pinned to the old string.
 *
 * WHY IT MUST RUN AFTER THE DEPLOY, NEVER BEFORE
 * Running it against the OLD code would apply the new variance figures to the
 * old model AND stamp every cache it then writes as pp-3. The real deploy would
 * arrive to find caches already labelled pp-3 and would not recompute a single
 * league, which is precisely the staleness the version exists to prevent.
 *
 * SAFETY
 * Every field is advanced only where the stored value still equals its pp-2
 * default. A figure an admin has genuinely tuned since is left alone and named
 * in the output, so a deliberate override is never silently overwritten.
 * Idempotent: a second run reports nothing left to do.
 *
 *   npm run migrate:power-pulse-pp3            preview, writes nothing
 *   npm run migrate:power-pulse-pp3 -- --apply
 */

import { getServiceClient } from "./_supabase";
import { DEFAULT_POWER_PULSE_SETTINGS } from "../lib/power-pulse/default-settings";
import type { PulsePosition } from "../lib/power-pulse/types";

/** What pp-2 held, so a hand-tuned value is distinguishable from an untouched one. */
const PP2_DEFAULTS = {
  modelVersion: "pp-2",
  defaultCv: { QB: 0.35, RB: 0.55, WR: 0.65, TE: 0.7, K: 0.5, DEF: 0.75 } as Record<
    PulsePosition,
    number
  >,
};

type Change = { path: string; from: unknown; to: unknown };
type Kept = { path: string; value: unknown; reason: string };

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const admin = getServiceClient();

  const { data, error } = await admin
    .from("league_power_pulse_settings")
    .select("settings")
    .eq("id", "global")
    .maybeSingle();
  if (error) throw new Error(`could not read the settings row: ${error.message}`);

  if (!data?.settings) {
    console.log(
      "No stored settings row. Nothing to migrate: the code defaults already apply, and pp-3 is live.",
    );
    return;
  }

  const stored = structuredClone(data.settings) as Record<string, unknown>;
  const changes: Change[] = [];
  const kept: Kept[] = [];

  if (stored.modelVersion === PP2_DEFAULTS.modelVersion) {
    changes.push({
      path: "modelVersion",
      from: stored.modelVersion,
      to: DEFAULT_POWER_PULSE_SETTINGS.modelVersion,
    });
    stored.modelVersion = DEFAULT_POWER_PULSE_SETTINGS.modelVersion;
  } else if (stored.modelVersion !== DEFAULT_POWER_PULSE_SETTINGS.modelVersion) {
    // An admin has set their own string. Leaving it alone is right, but it must
    // still differ from whatever the caches hold, so say so rather than assume.
    kept.push({
      path: "modelVersion",
      value: stored.modelVersion,
      reason:
        "set by hand, so it is left as it is. Check that no cached row already carries this string, or nothing will recompute.",
    });
  }

  const variance = (stored.variance ?? {}) as Record<string, unknown>;
  const cv = (variance.defaultCv ?? {}) as Record<string, number>;
  for (const position of Object.keys(PP2_DEFAULTS.defaultCv) as PulsePosition[]) {
    const old = PP2_DEFAULTS.defaultCv[position];
    const next = DEFAULT_POWER_PULSE_SETTINGS.variance.defaultCv[position];
    if (cv[position] === next) continue;
    if (cv[position] === old) {
      changes.push({ path: `variance.defaultCv.${position}`, from: cv[position], to: next });
      cv[position] = next;
    } else {
      kept.push({
        path: `variance.defaultCv.${position}`,
        value: cv[position],
        reason: "tuned away from the pp-2 default, so it is left as it is.",
      });
    }
  }
  variance.defaultCv = cv;
  stored.variance = variance;

  for (const c of changes) console.log(`  change  ${c.path}: ${String(c.from)} -> ${String(c.to)}`);
  for (const k of kept) console.log(`  keep    ${k.path} = ${String(k.value)} (${k.reason})`);

  if (changes.length === 0) {
    console.log("Nothing to change. The stored row already matches pp-3.");
    return;
  }

  if (!apply) {
    console.log(`\n${changes.length} change(s) pending. Re-run with --apply to write them.`);
    return;
  }

  const { error: writeError } = await admin
    .from("league_power_pulse_settings")
    .update({ settings: stored as never, updated_at: new Date().toISOString() })
    .eq("id", "global");
  if (writeError) throw new Error(`could not write the settings row: ${writeError.message}`);

  console.log(
    `\nApplied ${changes.length} change(s). Every league rescores on its next deep-view load.`,
  );
}

main().catch((err) => {
  console.error("[migrate-power-pulse-pp3]", err instanceof Error ? err.message : err);
  process.exit(1);
});
