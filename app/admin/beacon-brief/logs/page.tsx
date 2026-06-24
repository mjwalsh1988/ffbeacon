import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { BeaconBriefPageShell } from "@/components/admin/beacon-brief-page-shell";
import { LogPayloads } from "@/components/admin/beacon-brief/log-payloads";

export const metadata: Metadata = { title: "Logs" };
export const dynamic = "force-dynamic";

const STAGES = [
  "ingest",
  "dedupe",
  "revision_link",
  "revision_triage",
  "categorize",
  "article_write",
  "discord_post",
  "discord_patch",
  "deletion_check",
  "error",
];
const LEVELS = ["info", "warn", "error"];

const selectClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";

export default async function BeaconBriefLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; level?: string }>;
}) {
  await requireAdmin("/admin/beacon-brief/logs");
  const params = await searchParams;
  const stage = STAGES.includes(params.stage ?? "") ? params.stage! : "";
  const level = LEVELS.includes(params.level ?? "") ? params.level! : "";

  const admin = createAdminClient();
  // The request/response jsonb is intentionally NOT selected here: a page of 100
  // rows could otherwise ship up to 200 large blobs the admin may never open.
  // We only fetch metadata; the payloads lazy-load per row on expand.
  let query = admin
    .from("beacon_brief_logs")
    .select(
      "id, created_at, stage, level, message, model, duration_ms, ingestion_id",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (stage) query = query.eq("stage", stage);
  if (level) query = query.eq("level", level);
  const { data } = await query;
  const logs = data ?? [];

  // Existence-only probes (select just the id) so we know which disclosures to
  // render without transferring the jsonb itself to the server.
  const ids = logs.map((l) => l.id);
  const [reqRows, resRows] = ids.length
    ? await Promise.all([
        admin
          .from("beacon_brief_logs")
          .select("id")
          .in("id", ids)
          .not("request_payload", "is", null),
        admin
          .from("beacon_brief_logs")
          .select("id")
          .in("id", ids)
          .not("response_payload", "is", null),
      ])
    : [{ data: [] as { id: string }[] }, { data: [] as { id: string }[] }];
  const reqSet = new Set((reqRows.data ?? []).map((r) => r.id));
  const resSet = new Set((resRows.data ?? []).map((r) => r.id));

  return (
    <BeaconBriefPageShell
      title="Logs"
      description="The full Beacon Brief event log: every ingestion, AI call (with the exact prompt sent and the response received), Discord post or patch, deletion check, and error. Showing the 100 most recent matching entries."
    >
      <div className="space-y-6">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3"
          aria-label="Filter logs"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Stage</span>
            <select name="stage" defaultValue={stage} className={selectClass}>
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Level</span>
            <select name="level" defaultValue={level} className={selectClass}>
              <option value="">All levels</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan"
          >
            Apply filters
          </button>
        </form>

        {logs.length === 0 ? (
          <p className="text-sm text-ink-muted">No log entries match.</p>
        ) : (
          <ul className="space-y-3">
            {logs.map((l) => {
              return (
                <li
                  key={l.id}
                  className="rounded-card border border-line bg-surface/60 p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-ink-subtle">
                      {new Date(l.created_at).toLocaleString()}
                    </span>
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
                      {l.stage}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        l.level === "error"
                          ? "text-signal-danger"
                          : l.level === "warn"
                            ? "text-signal-warning"
                            : "text-ink-muted"
                      }`}
                    >
                      {l.level}
                    </span>
                    {l.model && (
                      <span className="font-mono text-xs text-ink-subtle">
                        {l.model}
                      </span>
                    )}
                    {typeof l.duration_ms === "number" && (
                      <span className="text-xs text-ink-subtle">
                        {l.duration_ms} ms
                      </span>
                    )}
                  </div>
                  {l.message && (
                    <p className="mt-2 text-sm text-ink">{l.message}</p>
                  )}
                  <LogPayloads
                    id={l.id}
                    hasReq={reqSet.has(l.id)}
                    hasRes={resSet.has(l.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-sm text-ink-muted">
          To edit the prompts the AI receives, go to the{" "}
          <a
            href="/admin/beacon-brief/settings"
            className="font-semibold text-brand-cyan underline"
          >
            Settings
          </a>{" "}
          page.
        </p>
      </div>
    </BeaconBriefPageShell>
  );
}
