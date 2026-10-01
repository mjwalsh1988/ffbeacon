/**
 * projection_report: how the projection did (plan section 23.4).
 *
 * The week by position as a table (graded games, how many beat the
 * projection, the average miss and which way it leaned), then two lists from
 * the season so far: the players who beat it most reliably, and the ones who
 * fell furthest below it. Every figure is a dataset cell; the source note says
 * which engine was graded and what a graded game is.
 *
 * Server component.
 */

import Link from "next/link";
import { PlayerHeadshot } from "@/components/player-headshot";
import type { BundleDataset } from "@/lib/brief-desk/types";
import { BLOCK_LINK_CLASS, BlockShell } from "./block-shell";

type Row = BundleDataset["rows"][number];

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
}

function signed(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "n/a";
  return v > 0 ? `+${v}` : String(v);
}

function PersonList({ rows, labelId, label, empty }: { rows: Row[]; labelId: string; label: string; empty: string }) {
  return (
    <div>
      <p id={labelId} className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </p>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ol aria-labelledby={labelId} role="list" className="mt-2 space-y-2">
          {rows.map((r) => {
            const slug = text(r.slug);
            const name = text(r.name) ?? "Unknown player";
            return (
              <li key={String(r.player_id)} className="flex items-center gap-2 text-sm">
                <PlayerHeadshot sleeperId={text(r.sleeper_id)} name="" size={32} className="shrink-0" />
                <span className="min-w-0">
                  {slug ? (
                    <Link href={`/players/${slug}`} className={`inline-flex min-h-11 items-center ${BLOCK_LINK_CLASS}`}>
                      {name}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{name}</span>
                  )}
                  <span className="block text-xs text-ink-muted">
                    {`${text(r.position) ?? ""} ${text(r.team) ?? ""}: beat it in ${text(r.games_beat) ?? "0"} of ${text(r.games_graded) ?? "0"} games, ${signed(r.avg_vs_projection)} a game against ${text(r.avg_projected) ?? "n/a"} projected`}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function ProjectionReportBlock({
  id,
  caption,
  conclusion,
  dataset,
}: {
  id: string;
  caption: string;
  conclusion: string;
  dataset: BundleDataset;
}) {
  const positions = dataset.rows.filter((r) => r.row_type === "position");
  const leaders = dataset.rows.filter((r) => r.row_type === "leader");
  const laggards = dataset.rows.filter((r) => r.row_type === "laggard");
  const label = caption || dataset.title || "Projection report";
  return (
    <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={dataset}>
      <ul role="list" aria-label={`${label}, by position`} className="space-y-2.5">
        {positions.map((r) => {
          const pct = typeof r.beat_pct === "number" ? r.beat_pct : null;
          const all = r.position === "ALL";
          return (
            <li key={String(r.position)} className={`grid grid-cols-[3.5rem_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[4.5rem_minmax(0,1fr)_14rem] ${all ? "border-t border-line pt-2.5" : ""}`}>
              <span className={`text-sm font-semibold ${all ? "text-ink" : "text-brand-cyan"}`}>{all ? "All" : String(r.position)}</span>
              {/* Decorative: the same figures are the text beside it. */}
              <span aria-hidden="true" className="relative h-2.5 overflow-hidden rounded-full bg-line/70">
                <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-purple to-brand-cyan" style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
                <span className="absolute inset-y-0 left-1/2 w-px bg-ink/60" />
              </span>
              <span className="col-start-2 text-xs leading-snug text-ink-muted sm:col-start-auto">
                <span className="font-semibold text-ink">{pct === null ? "n/a" : `${pct}% beat it`}</span>
                {`, ${text(r.beat) ?? "0"} of ${text(r.graded) ?? "0"}; average miss ${r.mean_abs_error === null ? "n/a" : `${r.mean_abs_error} points`}; lean ${signed(r.mean_error)}`}
                {all ? <span className="sr-only">, all four positions</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-subtle">The line in each bar is 50 percent. Lean is actual minus projected on average: above zero means the projection ran low.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <PersonList rows={leaders} labelId={`block-${id}-leaders`} label="Season: beat it most reliably" empty="Nobody has beaten the projection often enough to list yet." />
        <PersonList rows={laggards} labelId={`block-${id}-laggards`} label="Season: furthest below it" empty="Nobody projected for real points has fallen below it on average." />
      </div>
    </BlockShell>
  );
}
