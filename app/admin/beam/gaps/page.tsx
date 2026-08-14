import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern } from "@/lib/datetime";

export const metadata: Metadata = { title: "Unanswered questions | Ask BEAM" };
export const dynamic = "force-dynamic";

/**
 * The list that decides what BEAM learns next.
 *
 * Grouped by the NORMALIZED question, so "How many YARDS did Purdy throw for?"
 * and "how many yards did purdy throw for" count as one thing asked twice
 * instead of two things asked once. Grouping happens in application code over a
 * bounded window rather than in SQL, because PostgREST cannot express GROUP BY
 * and an RPC for an admin page nobody loads twice a day is not worth a
 * migration.
 *
 * Reason counts sit above the list, because "forty people hit no-player" and
 * "forty people hit out-of-scope" call for completely different work.
 */

const WINDOW_DAYS = 30;
const FETCH_CAP = 2000;

const REASON_LABEL: Record<string, string> = {
  "no-player": "Could not find the player",
  "no-intent": "Did not understand the question",
  "unsupported-stat": "Statistic we do not track",
  "no-data": "No data for that request",
  "out-of-scope": "About their own league",
  "not-ranked": "Player is not currently ranked",
  "too-many-players": "More than two players",
  "capability-disabled": "Capability switched off",
  error: "Something threw",
};

export default async function AdminBeamGapsPage() {
  await requireAdmin("/admin/beam/gaps");

  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await admin
    .from("beam_queries")
    .select("question, question_normalized, failure_reason, created_at, actor_hash")
    .in("outcome", ["unsupported", "error"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(FETCH_CAP);

  const rows = data ?? [];

  const byReason = new Map<string, number>();
  const byQuestion = new Map<
    string,
    {
      sample: string;
      count: number;
      askers: Set<string>;
      reason: string | null;
      latest: string;
    }
  >();

  for (const row of rows) {
    const reason = row.failure_reason ?? "unknown";
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);

    const key = row.question_normalized || row.question;
    const existing = byQuestion.get(key);
    if (existing) {
      existing.count += 1;
      if (row.actor_hash) existing.askers.add(row.actor_hash);
    } else {
      byQuestion.set(key, {
        sample: row.question,
        count: 1,
        askers: new Set(row.actor_hash ? [row.actor_hash] : []),
        reason: row.failure_reason,
        latest: row.created_at,
      });
    }
  }

  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
  // Ranked by DISTINCT askers, not raw row count.
  //
  // This list decides what BEAM learns next, and the ask endpoint accepts a
  // scripted request as readily as a browser one. Counting people rather than
  // requests means one determined script cannot manufacture a top priority; it
  // would need a lot of separate IPs to move this ordering.
  const questions = [...byQuestion.values()]
    .sort(
      (a, b) =>
        b.askers.size - a.askers.size ||
        b.count - a.count ||
        b.latest.localeCompare(a.latest),
    )
    .slice(0, 100);

  return (
    <div>
      <Link
        href="/admin/beam"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to Ask BEAM
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Unanswered questions
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Everything BEAM could not answer in the last {WINDOW_DAYS} days, grouped by the
        question and ordered by how many people asked it. {rows.length.toLocaleString("en-US")}{" "}
        {rows.length === 1 ? "question" : "questions"} in the window.
      </p>

      {reasons.length > 0 && (
        <section aria-labelledby="beam-gap-reasons" className="mt-6">
          <h2
            id="beam-gap-reasons"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-cyan"
          >
            Why they failed
          </h2>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {reasons.map(([reason, count]) => (
              <div
                key={reason}
                className="flex items-baseline justify-between gap-3 rounded-card border border-line bg-surface/60 px-3 py-2"
              >
                <dt className="text-sm text-ink">{REASON_LABEL[reason] ?? reason}</dt>
                <dd className="text-sm font-semibold text-ink">
                  {count.toLocaleString("en-US")}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-labelledby="beam-gap-questions" className="mt-8">
        <h2
          id="beam-gap-questions"
          className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-cyan"
        >
          Most asked
        </h2>
        {questions.length === 0 ? (
          <p className="mt-3 rounded-card border border-line bg-surface/60 p-4 text-sm text-ink-muted">
            Nothing yet. Either BEAM is answering everything, or nobody has asked.
          </p>
        ) : (
          <ul role="list" className="mt-3 space-y-2">
            {questions.map((entry) => (
              <li
                key={entry.sample + entry.latest}
                className="rounded-card border border-line bg-surface/60 p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{entry.sample}</p>
                  <p className="text-xs font-semibold text-brand-cyan">
                    {entry.askers.size.toLocaleString("en-US")}{" "}
                    {entry.askers.size === 1 ? "person" : "people"},{" "}
                    {entry.count.toLocaleString("en-US")}{" "}
                    {entry.count === 1 ? "time" : "times"}
                  </p>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {REASON_LABEL[entry.reason ?? "unknown"] ?? entry.reason ?? "unknown"} | last
                  asked {formatEastern(entry.latest)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
