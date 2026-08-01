import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus } from "@/lib/beacon-admin";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";
import { ReferenceActions } from "@/components/admin/reference-actions";
import {
  loadBeaconSettings,
  loadSignalWeights,
  resolveNormalizationMethod,
} from "@/lib/beacon/settings";
import { expectedSourcesFor, referenceAgeDays } from "@/lib/beacon/reference";
import { isDerivedFormat } from "@/lib/beacon/derived-formats";
import { formatEastern, formatRelative } from "@/lib/datetime";

export const metadata: Metadata = { title: "Calibration" };
export const dynamic = "force-dynamic";

type VersionRow = {
  id: string;
  format_config_id: string;
  version: number;
  status: string;
  generated_at: string;
  activated_at: string | null;
  shared_player_count: number;
  expected_sources: string[] | null;
  diagnostics: unknown;
  notes: string | null;
};

type DriftPreviewRow = {
  formatSlug: string;
  status: string;
  reason?: string;
  activeVersion?: number;
  ageDays?: number;
  metrics?: {
    players: number;
    meanAbs: number;
    maxMove: number;
    over250: number;
    over500: number;
    pctOver250: number;
    spearman: number;
  };
  alerts: string[];
};

/**
 * Read-only view of the calibration reference system, plus the two deliberate
 * operations (rebuild, roll back). Reference VALUES are never shown or edited
 * per player: what matters operationally is which version is live, how old it
 * is, how much evidence it was built from, and whether the last drift check
 * liked it.
 */
export default async function BeaconCalibrationPage() {
  await requireAdmin("/admin/beacon/calibration");
  const admin = createAdminClient();
  const nowMs = Date.now();

  const [settings, weights, recompute] = await Promise.all([
    loadBeaconSettings(admin),
    loadSignalWeights(admin),
    getRecomputeStatus(admin, nowMs),
  ]);

  const [{ data: ffRow }, { data: formatRows }, { data: srcRows }, { data: versionRows }, { data: driftRuns }] =
    await Promise.all([
      admin.from("source_registry").select("supported_format_slugs").eq("slug", "ffbeacon").maybeSingle(),
      admin.from("format_configs").select("id, slug, display_name, is_active").order("display_order"),
      admin.from("source_registry").select("slug, display_name, supported_format_slugs, data_type").eq("is_active", true).order("priority"),
      admin
        .from("beacon_reference_versions")
        .select("id, format_config_id, version, status, generated_at, activated_at, shared_player_count, expected_sources, diagnostics, notes")
        .order("generated_at", { ascending: false })
        .limit(200),
      admin
        .from("cron_runs")
        .select("started_at, status, result")
        .eq("job_name", "beacon-reference-drift")
        .order("started_at", { ascending: false })
        .limit(1),
    ]);

  const ffSlugs = ffRow?.supported_format_slugs ?? [];
  const allFfFormats = (formatRows ?? []).filter((f) => ffSlugs.includes(f.slug));
  // Derived boards inherit a baseline board's finished rows and never normalize,
  // so they never consult a reference. Listing them here would show a permanent
  // "no reference" state for boards that are working exactly as designed.
  const formats = allFfFormats.filter((f) => !isDerivedFormat(f.slug));
  const derivedFormats = allFfFormats.filter((f) => isDerivedFormat(f.slug));
  const enabledSourceSlugs = new Set(
    weights
      .filter((w) => w.signalType === "source_value" && w.isEnabled && w.sourceSlug)
      .map((w) => w.sourceSlug as string),
  );
  const valueSources = (srcRows ?? [])
    .filter((s) => s.slug !== "ffbeacon" && Array.isArray(s.data_type) && s.data_type.includes("player_value_history"))
    .map((s) => ({
      slug: s.slug,
      display: s.display_name ?? s.slug,
      supportedFormatSlugs: s.supported_format_slugs,
    }));
  const sourceDisplay = new Map(valueSources.map((s) => [s.slug, s.display]));

  const versions = (versionRows ?? []) as VersionRow[];
  const byFormat = new Map<string, VersionRow[]>();
  for (const v of versions) {
    const arr = byFormat.get(v.format_config_id) ?? [];
    arr.push(v);
    byFormat.set(v.format_config_id, arr);
  }

  const lastDrift = driftRuns?.[0] ?? null;
  const driftResult = (lastDrift?.result ?? null) as { previews?: DriftPreviewRow[] } | null;
  const driftByFormat = new Map<string, DriftPreviewRow>();
  for (const p of driftResult?.previews ?? []) driftByFormat.set(p.formatSlug, p);

  const calibratedFormats = formats.filter(
    (f) => resolveNormalizationMethod(f.slug, settings) === "calibrated",
  );

  return (
    <BeaconPageShell
      title="Calibration"
      description="The stored consensus scale each source is fitted onto when a format runs on calibrated normalization. This page shows which reference version is live per format, how old it is, how much agreement it was built from, and what the last drift check found. Reference values themselves are not editable: a change means a new version."
      recompute={recompute}
    >
      <div className="space-y-10">
        <section aria-labelledby="method-h">
          <h2 id="method-h" className="mb-3 text-lg font-semibold tracking-tight text-ink">
            What is switched on
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Global normalization method">{settings.normalizationMethod}</Field>
            <Field label="Calibrated formats (canary list)">
              {settings.calibrationFormatSlugs.length > 0
                ? settings.calibrationFormatSlugs.join(", ")
                : "none"}
            </Field>
            <Field label="Formats actually running calibrated">
              {calibratedFormats.length > 0
                ? calibratedFormats.map((f) => f.slug).join(", ")
                : "none"}
            </Field>
            <Field label="Minimum shared players">{settings.calibrationMinSharedPlayers}</Field>
            <Field label="Rebuild cadence">{settings.calibrationRebuildDays} days</Field>
            <Field label="Age alert">{settings.calibrationMaxAgeDays} days</Field>
          </dl>
          {calibratedFormats.length === 0 && (
            <p className="mt-3 rounded-card border border-line bg-surface/40 px-3 py-2 text-sm text-ink-muted">
              No format uses calibrated normalization right now, so every board is on the original
              method. Add one slug to the canary list on the Settings page to switch a single board
              over; clearing that box puts it straight back.
            </p>
          )}
        </section>

        <section aria-labelledby="drift-h">
          <h2 id="drift-h" className="mb-3 text-lg font-semibold tracking-tight text-ink">
            Last drift check
          </h2>
          {!lastDrift ? (
            <p className="rounded-card border border-line bg-surface/40 p-4 text-sm text-ink-muted">
              The drift check has never run. It compares a freshly built reference against the
              stored one and emails if the board would move too far. It is not scheduled yet.
            </p>
          ) : (
            <p className="rounded-card border border-line bg-surface/40 p-4 text-sm text-ink-muted">
              Ran {formatRelative(lastDrift.started_at, nowMs)}{" "}
              <span title={formatEastern(lastDrift.started_at)}>({formatEastern(lastDrift.started_at)})</span>, status{" "}
              {lastDrift.status}. Per-format results appear on each card below.
            </p>
          )}
        </section>

        <section aria-labelledby="formats-h">
          <h2 id="formats-h" className="mb-3 text-lg font-semibold tracking-tight text-ink">
            References by format
          </h2>
          <ul role="list" className="grid gap-4">
            {formats.map((f) => {
              const list = byFormat.get(f.id) ?? [];
              const active = list.find((v) => v.status === "active") ?? null;
              const rollback =
                list.find((v) => v.status === "superseded" && v.id !== active?.id) ?? null;
              const expected = expectedSourcesFor(
                f.slug,
                valueSources.filter((s) => enabledSourceSlugs.has(s.slug)),
              );
              const method = resolveNormalizationMethod(f.slug, settings);
              const drift = driftByFormat.get(f.slug);
              const age = active ? referenceAgeDays(active.generated_at, nowMs) : null;
              const diag = (active?.diagnostics ?? null) as
                | { sources?: Array<{ source: string; n: number; p99: number }> }
                | null;

              return (
                <li key={f.id} className="rounded-card border border-line bg-surface/60 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold text-ink">
                      {f.display_name ?? f.slug}{" "}
                      <span className="font-mono text-xs font-normal text-ink-subtle">{f.slug}</span>
                    </h3>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                      {method === "calibrated" ? "Calibrated" : "Original method"}
                    </p>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                    <Field label="Active version">
                      {active ? `v${active.version}` : "none"}
                    </Field>
                    <Field label="Built">
                      {active ? (
                        <span title={formatEastern(active.generated_at)}>
                          {formatRelative(active.generated_at, nowMs)}
                        </span>
                      ) : (
                        "n/a"
                      )}
                    </Field>
                    <Field label="Age">
                      {age === null ? "n/a" : `${age.toFixed(1)} d`}
                    </Field>
                    <Field label="Shared players">
                      {active ? active.shared_player_count : "n/a"}
                    </Field>
                    <Field label="Expected sources">
                      {expected.length > 0
                        ? expected.map((s) => sourceDisplay.get(s) ?? s).join(", ")
                        : "none"}
                    </Field>
                    <Field label="Built from">
                      {active?.expected_sources && active.expected_sources.length > 0
                        ? active.expected_sources.map((s) => sourceDisplay.get(s) ?? s).join(", ")
                        : "n/a"}
                    </Field>
                    <Field label="Rollback available">
                      {rollback ? `v${rollback.version}` : "none"}
                    </Field>
                    <Field label="Versions kept">{list.length}</Field>
                  </dl>

                  {diag?.sources && diag.sources.length > 0 && (
                    <p className="mt-2 text-xs text-ink-muted">
                      Pool sizes at build time:{" "}
                      {diag.sources
                        .map((s) => `${sourceDisplay.get(s.source) ?? s.source} ${s.n}`)
                        .join(", ")}
                      .
                    </p>
                  )}

                  {age !== null && age > settings.calibrationMaxAgeDays && (
                    <p className="mt-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2 text-xs text-signal-warning">
                      This reference is past the {settings.calibrationMaxAgeDays}-day age limit.
                    </p>
                  )}
                  {active && active.shared_player_count < settings.calibrationMinSharedPlayers && (
                    <p className="mt-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2 text-xs text-signal-warning">
                      This reference covers {active.shared_player_count} players, under the{" "}
                      {settings.calibrationMinSharedPlayers} minimum.
                    </p>
                  )}
                  {method === "calibrated" && !active && (
                    <p className="mt-2 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-3 py-2 text-xs text-signal-warning">
                      This format is set to calibrated but has no active reference, so a recompute
                      will stop with an error rather than guess at a scale. Build one below.
                    </p>
                  )}

                  {drift && (
                    <div className="mt-3 rounded-card border border-line bg-base/40 px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                        Last drift check
                      </p>
                      {drift.metrics ? (
                        <p className="mt-1 text-xs text-ink-muted">
                          A rebuild would move {drift.metrics.players} players by{" "}
                          {drift.metrics.meanAbs.toFixed(0)} on average, {drift.metrics.maxMove.toFixed(0)} at
                          most. {drift.metrics.over250} would move 250+, {drift.metrics.over500} would move
                          500+. Order correlation {drift.metrics.spearman.toFixed(4)}.
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-ink-muted">{drift.reason ?? drift.status}</p>
                      )}
                      {drift.alerts.length > 0 ? (
                        <ul role="list" className="mt-2 space-y-1">
                          {drift.alerts.map((a) => (
                            <li key={a} className="text-xs text-signal-warning">
                              {a}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-ink-muted">No threshold was crossed.</p>
                      )}
                    </div>
                  )}

                  <ReferenceActions
                    formatSlug={f.slug}
                    rollbackVersionId={rollback?.id ?? null}
                    rollbackVersionLabel={rollback ? `v${rollback.version}` : null}
                  />
                </li>
              );
            })}
          </ul>
          {derivedFormats.length > 0 && (
            <p className="mt-4 rounded-card border border-line bg-surface/40 px-3 py-2 text-sm text-ink-muted">
              {derivedFormats.length} more board
              {derivedFormats.length === 1 ? "" : "s"} ({derivedFormats.map((f) => f.slug).join(", ")}){" "}
              are built from a baseline board above rather than from sources directly, so they never
              normalize and need no reference. They inherit whichever method their baseline used.
            </p>
          )}
        </section>
      </div>
    </BeaconPageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
