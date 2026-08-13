import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadDraftValueSettings } from "@/lib/draft-value/settings";
import { formatEastern } from "@/lib/datetime";
import { DraftValueSettingsManager } from "./draft-value-settings-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Beacon Steals model" };

/**
 * A quick read on what the board currently looks like, so tuning is not blind.
 *
 * Counted with `head: true` aggregates rather than by materializing rows. The
 * first version pulled up to 5,000 rows on every load of a force-dynamic page to
 * produce six numbers, which was about 400 KB of JSON for data that fits in a
 * single aggregate. It also carried a silent cliff: PostgREST caps a read at
 * 1,000 rows whatever `.limit()` asks for, so with 4,136 rows on the board every
 * figure on this page was already under-reporting.
 */
async function loadBoardSummary(admin: ReturnType<typeof createAdminClient>) {
  const count = (category?: string) => {
    const query = admin
      .from("draft_value_targets")
      .select("player_id", { count: "exact", head: true });
    return category ? query.eq("category", category) : query;
  };

  const [total, steals, swings, fades, newest, formats] = await Promise.all([
    count(),
    count("steal"),
    count("swing"),
    count("fade"),
    admin
      .from("draft_value_targets")
      .select("computed_at, model_version")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The distinct view (migration 0193), which is eight rows rather than 4,136.
    admin.from("draft_value_board_formats").select("format_slug"),
  ]);

  if (!newest.data || (total.count ?? 0) === 0) return null;

  return {
    total: total.count ?? 0,
    formats: new Set((formats.data ?? []).map((f) => f.format_slug)).size,
    steals: steals.count ?? 0,
    swings: swings.count ?? 0,
    fades: fades.count ?? 0,
    computedAt: newest.data.computed_at,
    modelVersion: newest.data.model_version,
  };
}

export default async function DraftValueAdminPage() {
  await requireAdmin("/admin/draft-value");
  const admin = createAdminClient();
  const [settings, summary] = await Promise.all([
    loadDraftValueSettings(admin),
    loadBoardSummary(admin),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Beacon Steals model</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Every weight and threshold behind the draft guide board and the market line in the On The
        Clock room. Saving does not rebuild anything: the nightly job rescores against whatever is
        stored here when it next runs at 15:00 UTC, or run{" "}
        <code className="rounded bg-surface px-1 py-0.5 text-[13px]">
          npm run calculate:draft-value
        </code>{" "}
        to do it now. The engine falls back to safe code defaults if a value is ever missing.
      </p>

      {summary ? (
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-card border border-line bg-surface/40 p-3">
            <dt className="text-xs text-ink-muted">Rows on the board</dt>
            <dd className="mt-0.5 text-lg font-semibold text-ink">
              {summary.total.toLocaleString()} across {summary.formats} formats
            </dd>
          </div>
          <div className="rounded-card border border-line bg-surface/40 p-3">
            <dt className="text-xs text-ink-muted">Published buckets</dt>
            <dd className="mt-0.5 text-lg font-semibold text-ink">
              {summary.steals} steals, {summary.swings} swings, {summary.fades} fades
            </dd>
          </div>
          <div className="rounded-card border border-line bg-surface/40 p-3">
            <dt className="text-xs text-ink-muted">Last rebuilt</dt>
            <dd className="mt-0.5 text-sm font-semibold text-ink">
              {formatEastern(summary.computedAt)}
            </dd>
          </div>
          <div className="rounded-card border border-line bg-surface/40 p-3">
            <dt className="text-xs text-ink-muted">Model that produced it</dt>
            <dd className="mt-0.5 text-lg font-semibold text-ink">{summary.modelVersion}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-5 rounded-card border border-line bg-surface/40 p-4 text-sm text-ink-muted">
          No board has been built yet. Run{" "}
          <code className="rounded bg-surface px-1 py-0.5 text-[13px]">
            npm run calculate:draft-value
          </code>{" "}
          or wait for the nightly job.
        </p>
      )}

      <DraftValueSettingsManager initialSettings={settings} />
    </div>
  );
}
