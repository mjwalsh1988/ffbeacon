"use client";

/**
 * Weekly projections (statistics tab). A deliberately distinct treatment from
 * the plain stat tables: a gradient-outlined, softly glowing "Outlook" zone with
 * a season summary hero, a current-season projection trend chart, and a grid of
 * clickable week cards on near-black tiles so the big numbers pop. Tapping a card
 * opens a SidePanel (right drawer on desktop, bottom sheet on mobile) with the
 * full projected stat line for that week. Points are computed on the server (TEP
 * already applied) and passed in as plain numbers, so this client component only
 * needs the isomorphic shaping helpers, never the server data layer.
 */

import { useState } from "react";
import { Target, ChevronRight, LineChart } from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import { ProjectionActualChart } from "@/components/player-profile/projection-actual-chart";
import { AccuracyStatCards } from "@/components/player-profile/accuracy-stat-cards";
import {
  lineFromProjection,
  projectionStatColumns,
  type AccuracyPoint,
  type BeatRate,
} from "@/components/player-profile/stat-shaping";

/** Near-black tile so the bright stat numbers stand out. */
const TILE = "#0A0A12";

export type ProjectionWeekCard = {
  week: number;
  opponent: string | null;
  team: string | null;
  /** Projected points for the active scoring, TEP already applied server-side. */
  points: number | null;
  /** Raw projected stat map for the detail panel's component stats. */
  stats: Record<string, unknown> | null;
};

function fmtPts(v: number | null): string {
  return v != null ? v.toFixed(1) : "-";
}

export function WeeklyProjections({
  cards,
  position,
  scoringLabel,
  season,
  totalPoints,
  perGame,
  upcomingWeeks,
  seasonStarted,
  tePremiumBonus = 0,
  accuracyPoints = [],
  beatRate = null,
}: {
  cards: ProjectionWeekCard[];
  position: string;
  scoringLabel: string;
  season: number | null;
  totalPoints: number;
  perGame: number | null;
  upcomingWeeks: number;
  seasonStarted: boolean;
  tePremiumBonus?: number;
  /** Current-season projected-vs-actual weeks; actual fills in as games play. */
  accuracyPoints?: AccuracyPoint[];
  /** Season-wide beat rate (missed weeks count as misses) for the beat rate tile. */
  beatRate?: BeatRate | null;
}) {
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const selected = cards.find((c) => c.week === openWeek) ?? null;
  const totalLabel = seasonStarted ? "Rest of season" : "Full season";
  const hasChart = accuracyPoints.some((p) => p.projected != null);

  return (
    // Gradient hairline border + soft glow set this zone apart from the tables.
    <div className="rounded-modal bg-gradient-to-br from-brand-purple/60 via-line/30 to-brand-cyan/50 p-px shadow-[0_0_64px_-26px_rgba(168,85,247,0.6)]">
      <section
        aria-labelledby="weekly-projections-heading"
        className="relative overflow-hidden rounded-[15px] bg-gradient-to-b from-brand-purple/[0.12] via-surface/60 to-base"
      >
        {/* Soft top glow. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-28"
          style={{ background: "radial-gradient(65% 100% at 50% 0%, rgba(168,85,247,0.20), transparent 70%)" }}
        />

        <div className="relative px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-purple">
              <Target aria-hidden="true" className="h-3.5 w-3.5" />
              {season ?? ""} Outlook
            </p>
            <span className="rounded-full border border-brand-purple/40 bg-brand-purple/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-brand-purple">
              Projections
            </span>
          </div>
          <h2 id="weekly-projections-heading" className="mt-1 text-lg font-bold tracking-tight text-ink">
            Weekly projections
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Sleeper projected points, {scoringLabel} scoring. Select a week for its full
            projected stat line.
          </p>

          {/* Season summary hero (near-black tiles). */}
          <dl className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-card border border-brand-purple/30 px-3 py-2.5" style={{ backgroundColor: TILE }}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                {totalLabel} pts
              </dt>
              <dd className="mt-0.5 font-mono text-xl font-bold tabular-nums text-brand-purple">
                {totalPoints.toFixed(1)}
              </dd>
            </div>
            <div className="rounded-card border border-line px-3 py-2.5" style={{ backgroundColor: TILE }}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                Per game
              </dt>
              <dd className="mt-0.5 font-mono text-xl font-bold tabular-nums text-brand-cyan">
                {perGame != null ? perGame.toFixed(1) : "-"}
              </dd>
            </div>
            <div className="rounded-card border border-line px-3 py-2.5" style={{ backgroundColor: TILE }}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                Weeks left
              </dt>
              <dd className="mt-0.5 font-mono text-xl font-bold tabular-nums text-ink">{upcomingWeeks}</dd>
            </div>
          </dl>

          {/* Current-season projection trend (actual overlays as games play). */}
          {season != null && hasChart && (
            <>
              <div className="mt-4 rounded-card border border-line p-3" style={{ backgroundColor: TILE }}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-cyan">
                    <LineChart aria-hidden="true" className="h-3.5 w-3.5" />
                    {season} projection trend
                  </p>
                  <p className="text-[10px] text-ink-subtle">actual overlays as games play</p>
                </div>
                <ProjectionActualChart points={accuracyPoints} scoringLabel={scoringLabel} season={season} />
              </div>
              <AccuracyStatCards points={accuracyPoints} mode="projection" beatRate={beatRate} />
            </>
          )}

          {/* Week cards (near-black tiles). */}
          <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {cards.map((c) => (
              <li key={c.week}>
                <button
                  type="button"
                  onClick={() => setOpenWeek(c.week)}
                  aria-haspopup="dialog"
                  aria-label={`Week ${c.week}${
                    c.opponent ? ` versus ${c.opponent}` : ""
                  }, ${fmtPts(c.points)} projected ${scoringLabel} points. Open the full projection.`}
                  style={{ backgroundColor: TILE }}
                  className="group flex w-full flex-col rounded-card border border-line p-3 text-left transition-all hover:-translate-y-0.5 hover:border-brand-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">
                      Wk {c.week}
                    </span>
                    <span className="truncate text-[11px] font-medium text-ink-muted">
                      {c.opponent ? `vs ${c.opponent}` : "TBD"}
                    </span>
                  </span>
                  <span className="mt-2 font-mono text-2xl font-bold tabular-nums text-brand-cyan">
                    {fmtPts(c.points)}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between text-[10px] text-ink-subtle">
                    <span>proj {scoringLabel}</span>
                    <ChevronRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-cyan"
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {tePremiumBonus > 0 && (
            <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
              Projected points include a tight end premium of +{tePremiumBonus} per reception (
              {tePremiumBonus} x projected receptions).
            </p>
          )}
        </div>

        <SidePanel
          open={selected != null}
          onClose={() => setOpenWeek(null)}
          title={selected ? `Week ${selected.week} projection` : ""}
          subtitle={
            selected
              ? `${season ?? ""} season${selected.opponent ? `, vs ${selected.opponent}` : ""}`
              : undefined
          }
        >
          {selected && (
            <ProjectionDetail
              card={selected}
              position={position}
              scoringLabel={scoringLabel}
              tePremiumBonus={tePremiumBonus}
            />
          )}
        </SidePanel>
      </section>
    </div>
  );
}

function ProjectionDetail({
  card,
  position,
  scoringLabel,
  tePremiumBonus,
}: {
  card: ProjectionWeekCard;
  position: string;
  scoringLabel: string;
  tePremiumBonus: number;
}) {
  const line = lineFromProjection(card.stats);
  const cols = projectionStatColumns(position);
  const tepPoints = tePremiumBonus > 0 ? tePremiumBonus * line.rec : 0;

  return (
    <div className="space-y-4">
      {/* Projected points hero */}
      <div className="rounded-card border border-brand-cyan/25 bg-gradient-to-br from-brand-cyan/10 to-transparent px-4 py-4 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
          Projected {scoringLabel} points
        </p>
        <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-brand-cyan">
          {fmtPts(card.points)}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Week {card.week}
          {card.opponent ? ` vs ${card.opponent}` : ""}
        </p>
      </div>

      {/* Projected component stat line */}
      {cols.length > 0 ? (
        <dl className="grid grid-cols-2 gap-2">
          {cols.map((c) => (
            <div key={c.label} className="rounded-card border border-line bg-base/40 px-3 py-2">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
                {c.label}
              </dt>
              <dd className="mt-0.5 font-mono text-lg font-bold tabular-nums text-ink">
                {c.get(line)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-ink-muted">
          No detailed projected stat line for this position.
        </p>
      )}

      {tePremiumBonus > 0 && (
        <p className="rounded-card border border-dashed border-line bg-base/30 px-3 py-2 text-[11px] leading-relaxed text-ink-subtle">
          Includes a tight end premium of +{tepPoints.toFixed(1)} points (+{tePremiumBonus} per
          reception x {line.rec.toFixed(1)} projected receptions).
        </p>
      )}
    </div>
  );
}
