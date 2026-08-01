/**
 * Calibration reference CLI. Implementation lives in lib/beacon/reference.ts so
 * the cron routes, the admin actions, and this script share one code path.
 *
 * Run:
 *   npm run beacon:reference -- --status
 *   npm run beacon:reference -- --drift
 *   npm run beacon:reference -- --drift --format dynasty-ppr-sflex
 *   npm run beacon:reference -- --rebuild --format dynasty-ppr-sflex
 *   npm run beacon:reference -- --rebuild --format dynasty-ppr-sflex --force
 *
 * --rebuild is the ONLY thing here that writes. Without --force it honours the
 * rebuild cadence, so it is safe to run repeatedly. With --force it replaces the
 * reference immediately, subject to the same source-completeness and shared-
 * player gates, which cannot be bypassed from anywhere.
 */

import { getServiceClient } from "./_supabase";
import { loadBeaconSettings } from "../lib/beacon/settings";
import { isDerivedFormat } from "../lib/beacon/derived-formats";
import {
  loadActiveReferences,
  previewReferenceDrift,
  rebuildReferences,
  referenceAgeDays,
} from "../lib/beacon/reference";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const supabase = getServiceClient();
  const nowMs = Date.now();
  const formatSlug = argValue("--format");
  const formatSlugs = formatSlug ? [formatSlug] : undefined;

  if (process.argv.includes("--rebuild")) {
    const outcomes = await rebuildReferences(supabase, {
      formatSlugs,
      force: process.argv.includes("--force"),
      nowMs,
      notes: "Manual rebuild from scripts/beacon-reference.ts",
    });
    console.log(JSON.stringify(outcomes, null, 2));
    if (outcomes.some((o) => o.status === "refused")) process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--drift")) {
    const previews = await previewReferenceDrift(supabase, { formatSlugs, nowMs });
    console.log(JSON.stringify(previews, null, 2));
    return;
  }

  // Default: status.
  const settings = await loadBeaconSettings(supabase);
  const { data: ffRow } = await supabase
    .from("source_registry")
    .select("supported_format_slugs")
    .eq("slug", "ffbeacon")
    .maybeSingle();
  const ffSlugs = ffRow?.supported_format_slugs ?? [];
  const { data: formats } = await supabase.from("format_configs").select("id, slug");
  const wanted = (formats ?? [])
    .filter((f) => ffSlugs.includes(f.slug))
    // Derived boards inherit a baseline's finished rows and never normalize, so
    // they never hold a reference. Listing them would be permanent nulls.
    .filter((f) => !isDerivedFormat(f.slug))
    .filter((f) => !formatSlugs || formatSlugs.includes(f.slug));

  const active = await loadActiveReferences(
    supabase,
    wanted.map((f) => f.id),
  );
  console.log(
    JSON.stringify(
      {
        normalization_method: settings.normalizationMethod,
        calibrated_formats: settings.calibrationFormatSlugs,
        min_shared_players: settings.calibrationMinSharedPlayers,
        rebuild_days: settings.calibrationRebuildDays,
        references: wanted.map((f) => {
          const ref = active.get(f.id) ?? null;
          return {
            format: f.slug,
            version: ref?.version ?? null,
            generated_at: ref?.generatedAt ?? null,
            age_days: ref ? Number(referenceAgeDays(ref.generatedAt, nowMs).toFixed(2)) : null,
            shared_players: ref?.sharedPlayerCount ?? null,
            expected_sources: ref?.expectedSources ?? null,
          };
        }),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
