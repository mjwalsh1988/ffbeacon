"use client";

/**
 * Premium player spotlight: the hero of the draft room. Styled like a draft-night
 * broadcast lower-third / big-board feature graphic, not a generic card. Big
 * headshot, big name, bold accent value treatment, and a positional-finish stat
 * strip (mock-only, hidden when absent).
 *
 * Variants: "best" (Pure Value) / "need" (Roster Need) / "aligned" (one card when
 * the top value player is also the top need). PLACEHOLDER data for Phase 4.5; the
 * Phase 6 engine fills RecommendationCardData. All numbers carry text labels, so
 * nothing is conveyed by color alone.
 */

import { TrendingUp, Target, Sparkles, type LucideIcon } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import type { RecommendationCardData } from "./fixtures";

type Variant = "best" | "need" | "aligned";

const VARIANT: Record<Variant, { label: string; sub: string; icon: LucideIcon; accent: string }> = {
  best: {
    label: "Pure Value",
    sub: "Highest value left on the board",
    icon: TrendingUp,
    accent: "text-brand-purple",
  },
  need: {
    label: "Roster Need",
    sub: "Best fit for your roster",
    icon: Target,
    accent: "text-brand-cyan",
  },
  aligned: {
    label: "Value and need align",
    sub: "The top value player is also your biggest need",
    icon: Sparkles,
    accent: "text-brand-cyan",
  },
};

function FinishStrip({ finishes }: { finishes: string[] }) {
  return (
    <div className="mt-4 rounded-card border border-line bg-base/50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        Last positional finishes
      </p>
      <ul role="list" aria-label="Recent positional finishes, newest first" className="mt-1.5 flex gap-2.5">
        {finishes.map((f, i) => (
          <li
            key={`${f}-${i}`}
            className="rounded-card border border-line bg-surface px-2.5 py-1 font-mono text-base font-bold tabular-nums text-brand-cyan"
          >
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlayerSpotlight({ data, variant }: { data: RecommendationCardData; variant: Variant }) {
  const v = VARIANT[variant];
  const Icon = v.icon;
  const p = data.player;

  return (
    <article
      aria-label={`${v.label}. ${p ? p.name : "No recommendation yet"}`}
      className="relative overflow-hidden rounded-modal border border-line bg-surface/60 p-5 sm:p-6"
      style={{
        boxShadow: "0 0 90px -50px rgba(34, 211, 238, 0.5)",
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      {/* Label badge (broadcast tag) */}
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className={`text-sm font-bold uppercase tracking-wide ${v.accent}`}>{v.label}</p>
          <p className="text-[11px] text-ink-subtle">{v.sub}</p>
        </div>
      </div>

      {!p ? (
        <p className="mt-5 text-sm leading-relaxed text-ink-muted">
          We will tailor this the moment we can detect your team or you make your first pick.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* Headshot, framed */}
          <div
            className="relative shrink-0 self-start rounded-modal border border-line bg-base p-1.5"
            style={{ boxShadow: "0 0 40px -20px rgba(168, 85, 247, 0.6)" }}
          >
            <PlayerHeadshot sleeperId={p.sleeperId} name={p.name} position={p.position} size={96} />
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl">
              {p.name}
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-muted">
              <span className="font-semibold text-ink">{p.position}</span>
              {p.team && <span>· {p.team}</span>}
              <span>· Overall #{p.overallRank}</span>
              {typeof p.yearsExperience === "number" && (
                <span>· {p.yearsExperience === 0 ? "Rookie" : `${p.yearsExperience} yr exp`}</span>
              )}
              {typeof p.age === "number" && <span>· Age {p.age}</span>}
            </p>

            {/* Accent number row (broadcast stat treatment) */}
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-card border border-brand-purple/40 bg-base/50 px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                  FF Beacon value
                </dt>
                <dd className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-brand-purple">
                  {p.value.toLocaleString()}
                </dd>
              </div>
              <div className="rounded-card border border-line bg-base/50 px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                  Pos rank
                </dt>
                <dd className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-ink">
                  {p.position}
                  {p.positionRank}
                </dd>
              </div>
              <div className="rounded-card border border-line bg-base/50 px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                  Tier
                </dt>
                <dd className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-ink">
                  {p.tier}
                </dd>
              </div>
            </dl>

            {data.filledSlot && (
              <p className="mt-3 inline-flex items-center gap-1 rounded-full border border-brand-cyan/40 px-2.5 py-1 text-xs font-semibold text-brand-cyan">
                Fills your open {data.filledSlot} slot
              </p>
            )}

            <p className="mt-3 text-sm leading-relaxed text-ink">{data.reason}</p>
            {p.shortNote && <p className="mt-1.5 text-xs italic text-ink-muted">{p.shortNote}</p>}

            {p.recentFinishes && p.recentFinishes.length > 0 && (
              <FinishStrip finishes={p.recentFinishes} />
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** Compact secondary recommendation shown beside/below the primary spotlight. */
export function SecondaryPick({ data, variant }: { data: RecommendationCardData; variant: Variant }) {
  const v = VARIANT[variant];
  const Icon = v.icon;
  const p = data.player;
  return (
    <article
      aria-label={`${v.label}. ${p ? p.name : "No recommendation yet"}`}
      className="rounded-card border border-line bg-surface/50 p-4"
    >
      <p className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${v.accent}`}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {v.label}
      </p>
      {!p ? (
        <p className="mt-2 text-sm text-ink-muted">Pending your first pick.</p>
      ) : (
        <div className="mt-2 flex items-center gap-3">
          <PlayerHeadshot sleeperId={p.sleeperId} name={p.name} position={p.position} size={40} />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink">{p.name}</p>
            <p className="text-xs text-ink-muted">
              {p.position}
              {p.positionRank} · {p.team ?? ""} ·{" "}
              <span className="font-mono font-bold tabular-nums text-brand-purple">
                {p.value.toLocaleString()}
              </span>
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
