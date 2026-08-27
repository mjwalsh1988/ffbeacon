import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern } from "@/lib/datetime";

export const metadata: Metadata = { title: "League health" };
export const dynamic = "force-dynamic";

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const CANDIDATE_LIMIT = 500;
const STATUSES = ["ok", "skipped", "settled", "error"] as const;
type Status = (typeof STATUSES)[number] | "pending";

type LeagueHealthRow = {
  id: string;
  sleeper_league_id: string;
  name: string | null;
  season: number | null;
  last_pulsed_at: string | null;
  power_pulse_status: string | null;
  power_pulse_detail: string | null;
  power_pulse_attempted_at: string | null;
  power_pulse_succeeded_at: string | null;
  positional_war_status: string | null;
  positional_war_detail: string | null;
  positional_war_attempted_at: string | null;
  positional_war_succeeded_at: string | null;
};

export default async function LeagueHealthPage() {
  await requireAdmin("/admin/system/league-health");
  const admin = createAdminClient();

  const since48h = new Date(Date.now() - FORTY_EIGHT_HOURS_MS).toISOString();

  const [powerPulseCounts, positionalWarCounts, fingerprintCollisions, candidates] =
    await Promise.all([
      countByStatus(admin, "power_pulse_status"),
      countByStatus(admin, "positional_war_status"),
      admin
        .from("leagues")
        .select("id", { count: "exact", head: true })
        .ilike("positional_war_detail", "%fingerprint collision%"),
      // A candidate set, not the final list: every league with either
      // feature in 'error', plus every league pulsed in the last 48 hours
      // (the population the stale-succeeded signature can apply to). The
      // exact per-row fault condition is applied below in memory, because it
      // needs both timestamps compared against "now" rather than a single
      // column filter.
      admin
        .from("leagues")
        .select(
          "id, sleeper_league_id, name, season, last_pulsed_at, power_pulse_status, power_pulse_detail, power_pulse_attempted_at, power_pulse_succeeded_at, positional_war_status, positional_war_detail, positional_war_attempted_at, positional_war_succeeded_at",
        )
        .or(
          `power_pulse_status.eq.error,positional_war_status.eq.error,last_pulsed_at.gte.${since48h}`,
        )
        .order("last_pulsed_at", { ascending: false, nullsFirst: false })
        .limit(CANDIDATE_LIMIT),
    ]);

  const rows = ((candidates.data ?? []) as LeagueHealthRow[]).filter(isFault);
  rows.sort((a, b) => {
    const aErr = a.power_pulse_status === "error" || a.positional_war_status === "error";
    const bErr = b.power_pulse_status === "error" || b.positional_war_status === "error";
    if (aErr !== bErr) return aErr ? -1 : 1;
    return timeMs(b.last_pulsed_at) - timeMs(a.last_pulsed_at);
  });

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">
          System Settings
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          League health
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          Power Pulse and Positional WAR both refresh per league, on view, with
          their own backoff. This page shows whether that is working: counts by
          status, and every league whose refresh is either erroring or has gone
          quiet while the league itself is active.
        </p>
      </div>

      <section aria-labelledby="lh-counts">
        <h2
          id="lh-counts"
          className="text-lg font-semibold tracking-tight text-ink"
        >
          Counts by status
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <StatusCountCard title="Power Pulse" counts={powerPulseCounts} />
          <StatusCountCard title="Positional WAR" counts={positionalWarCounts} />
        </div>
        <div className="mt-3 rounded-card border border-line bg-surface/60 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
            Fingerprint collisions
          </p>
          <p
            className={`mt-1 text-2xl font-bold ${
              (fingerprintCollisions.count ?? 0) > 0 ? "text-signal-danger" : "text-ink"
            }`}
          >
            {fingerprintCollisions.count ?? 0}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">
            Leagues whose Positional WAR detail reports a fingerprint
            collision.
          </p>
        </div>
      </section>

      <section aria-labelledby="lh-table">
        <h2
          id="lh-table"
          className="text-lg font-semibold tracking-tight text-ink"
        >
          Leagues needing attention
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          Every league where either feature is in <code>error</code>, or where
          a feature was attempted, has not succeeded in over 48 hours, and
          belongs to a league pulsed inside that window. A league a feature has
          never been attempted for is excluded: it is waiting for someone to
          open the page, which is not a fault.
        </p>

        {rows.length === 0 ? (
          <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
            No leagues currently match either signal.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-card border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Leagues with a Power Pulse or Positional WAR fault, newest
                pulsed first, errors first
              </caption>
              <thead>
                <tr className="border-b border-line bg-surface/60 text-left text-xs uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="px-3 py-2">
                    League
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Last pulsed
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Power Pulse
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Positional WAR
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lg) => (
                  <tr key={lg.id} className="border-b border-line/60 last:border-b-0 align-top">
                    <td className="px-3 py-2">
                      <p className="font-medium text-ink">
                        {lg.name ?? "Unnamed league"}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {lg.season ?? "Unknown season"}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-subtle">
                        {lg.sleeper_league_id}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {formatEastern(lg.last_pulsed_at)}
                    </td>
                    <td className="px-3 py-2">
                      <FeatureCell
                        status={lg.power_pulse_status}
                        detail={lg.power_pulse_detail}
                        attemptedAt={lg.power_pulse_attempted_at}
                        succeededAt={lg.power_pulse_succeeded_at}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <FeatureCell
                        status={lg.positional_war_status}
                        detail={lg.positional_war_detail}
                        attemptedAt={lg.positional_war_attempted_at}
                        succeededAt={lg.positional_war_succeeded_at}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------- data ---------- */

async function countByStatus(
  admin: ReturnType<typeof createAdminClient>,
  column: "power_pulse_status" | "positional_war_status",
): Promise<Record<Status, number>> {
  const counts = {} as Record<Status, number>;
  await Promise.all(
    STATUSES.map(async (status) => {
      const { count } = await admin
        .from("leagues")
        .select("id", { count: "exact", head: true })
        .eq(column, status);
      counts[status] = count ?? 0;
    }),
  );
  // A null status is a pre-migration row or a league that has never
  // attempted this feature. Both behave as 'pending': no backoff, a normal
  // first attempt, so it is counted as pending here rather than left out.
  const { count: pendingCount } = await admin
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .is(column, null);
  counts.pending = pendingCount ?? 0;
  return counts;
}

function timeMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * The systemic-break signature: a feature that HAS been attempted, has not
 * succeeded in over 48 hours, and belongs to a league that was itself pulsed
 * inside that window.
 *
 * The attempt is load-bearing and was not in the first version of this check.
 * `last_pulsed_at` is written by the LEAGUE sync, not by either of these
 * features, so a league pulsed yesterday and never scored has a recent
 * `last_pulsed_at` and a null `succeeded_at` through no fault of anything. On
 * the day Positional WAR shipped that described 55 of 212 leagues, and a health
 * view whose first act is to report a quarter of the estate as broken teaches
 * an admin to stop reading it. A feature that has never been attempted for a
 * league is not failing for that league; it is simply waiting for someone to
 * open the page.
 */
function staleSignature(
  lastPulsedAt: string | null,
  attemptedAt: string | null,
  succeededAt: string | null,
): boolean {
  if (!lastPulsedAt) return false;
  if (!attemptedAt) return false;
  const pulsedMsAgo = Date.now() - timeMs(lastPulsedAt);
  if (pulsedMsAgo < 0 || pulsedMsAgo >= FORTY_EIGHT_HOURS_MS) return false;
  if (!succeededAt) return true;
  return Date.now() - timeMs(succeededAt) >= FORTY_EIGHT_HOURS_MS;
}

function isFault(lg: LeagueHealthRow): boolean {
  if (lg.power_pulse_status === "error" || lg.positional_war_status === "error") return true;
  if (
    staleSignature(lg.last_pulsed_at, lg.power_pulse_attempted_at, lg.power_pulse_succeeded_at)
  ) {
    return true;
  }
  if (
    staleSignature(
      lg.last_pulsed_at,
      lg.positional_war_attempted_at,
      lg.positional_war_succeeded_at,
    )
  ) {
    return true;
  }
  return false;
}

/* ---------- presentation ---------- */

function StatusCountCard({
  title,
  counts,
}: {
  title: string;
  counts: Record<Status, number>;
}) {
  const order: Status[] = ["ok", "skipped", "settled", "error", "pending"];
  return (
    <div className="rounded-card border border-line bg-surface/60 p-4">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <dl className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
        {order.map((status) => (
          <div key={status}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
              {status}
            </dt>
            <dd
              className={`mt-0.5 text-lg font-bold tabular-nums ${
                status === "error" && counts[status] > 0 ? "text-signal-danger" : "text-ink"
              }`}
            >
              {counts[status]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function FeatureCell({
  status,
  detail,
  attemptedAt,
  succeededAt,
}: {
  status: string | null;
  detail: string | null;
  attemptedAt: string | null;
  succeededAt: string | null;
}) {
  const label = status ?? "pending";
  return (
    <div className="space-y-1">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusTone(
          label,
        )}`}
      >
        {label}
      </span>
      {detail ? (
        <p className="max-w-sm text-xs text-ink-muted">{detail}</p>
      ) : null}
      <p className="text-[11px] text-ink-subtle">
        Attempted {formatEastern(attemptedAt)}
      </p>
      <p className="text-[11px] text-ink-subtle">
        Succeeded {formatEastern(succeededAt)}
      </p>
    </div>
  );
}

function statusTone(status: string): string {
  if (status === "error") return "border-signal-danger/40 bg-signal-danger/10 text-signal-danger";
  if (status === "ok") return "border-signal-success/40 bg-signal-success/10 text-signal-success";
  if (status === "settled") return "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan";
  if (status === "skipped")
    return "border-signal-warning/40 bg-signal-warning/10 text-signal-warning";
  return "border-line bg-surface text-ink-muted";
}
