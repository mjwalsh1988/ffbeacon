"use client";

/**
 * The two draft-signal spotlights: Best Available and Team Need.
 *
 * Styled like a draft-night broadcast feature graphic rather than a generic
 * card, because this is the thing a drafter looks at with a clock running. Big
 * headshot, big name, a stat rail of every number that should move a decision,
 * and then the argument itself in plain English.
 *
 * THE ARGUMENT IS THE POINT. A recommendation that only says "Breece Hall" is
 * asking to be trusted. This card shows the board price, the market price, the
 * points he adds to the lineup, what waiting costs, what he has actually
 * finished, and one honest caveat, so a drafter can disagree with it on the
 * merits. Copy comes from lib/on-the-clock/rationale.ts; nothing is written
 * here.
 *
 * Variants: "best" (pure value) / "need" (roster need) / "aligned" (one card
 * when the top value player is also the top need).
 *
 * Nothing is conveyed by color alone: every tone carries its own title and
 * icon, every number carries a text label, and every absent number is spoken as
 * a reason rather than shown as a bare dash.
 */

import {
  TrendingUp,
  TrendingDown,
  Target,
  Sparkles,
  Gem,
  ListChecks,
  Hourglass,
  Compass,
  History,
  Lightbulb,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import type { RecommendationCardData } from "./fixtures";
import type { RationalePoint, RationaleTone, SeasonFinish } from "@/lib/on-the-clock/rationale";

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

/** Icon + accent per argument lens. The title says the same thing in words. */
const TONE: Record<RationaleTone, { icon: LucideIcon; border: string; icon_bg: string }> = {
  value: {
    icon: Gem,
    border: "border-l-brand-purple/70",
    icon_bg: "border-brand-purple/40 bg-brand-purple/10 text-brand-purple",
  },
  lineup: {
    icon: ListChecks,
    border: "border-l-brand-cyan/70",
    icon_bg: "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan",
  },
  timing: {
    icon: Hourglass,
    border: "border-l-amber-400/70",
    icon_bg: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  },
  build: {
    icon: Compass,
    border: "border-l-sky-400/70",
    icon_bg: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  },
  track: {
    icon: History,
    border: "border-l-emerald-400/70",
    icon_bg: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  },
};

export interface SpotlightExtras {
  /** The plain-English argument, most persuasive first. */
  rationale?: RationalePoint[];
  /** The one honest downside, when there is one. */
  caveat?: string | null;
  /** Season-end positional finishes, newest first. */
  finishes?: SeasonFinish[];
  /** Which scoring those finishes were computed in ("PPR", "Half PPR"). */
  finishScoringLabel?: string;
  /** True while the history request is still in the air. */
  finishesLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/**
 * One number in the stat rail.
 *
 * Two accessibility decisions worth keeping. `missing` is spoken rather than
 * left as a bare dash, because "no projection for this player" tells a
 * screen-reader user something and a hyphen tells them nothing. And
 * `shortLabel` shortens only the PIXELS: the abbreviation is aria-hidden and
 * the full label is always the announced one, because a listener gains nothing
 * from a narrow viewport and loses a lot from hearing "F F B value".
 */
function Stat({
  label,
  shortLabel,
  value,
  sub,
  missing,
  emphasis = "plain",
}: {
  label: string;
  /** Shorter VISIBLE label at narrow widths. Never changes what is announced. */
  shortLabel?: string;
  value: string | null;
  sub?: string | null;
  missing?: string;
  emphasis?: "plain" | "purple" | "cyan";
}) {
  const border =
    emphasis === "purple"
      ? "border-brand-purple/40"
      : emphasis === "cyan"
        ? "border-brand-cyan/40"
        : "border-line";
  const tone =
    emphasis === "purple"
      ? "text-brand-purple"
      : emphasis === "cyan"
        ? "text-brand-cyan"
        : "text-ink";
  return (
    <div className={`min-w-0 rounded-card border ${border} bg-base/50 px-3 py-2`}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {shortLabel ? (
          <>
            <span aria-hidden="true" className="sm:hidden">
              {shortLabel}
            </span>
            <span aria-hidden="true" className="hidden sm:inline">
              {label}
            </span>
            <span className="sr-only">{label}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className="mt-0.5">
        {value === null ? (
          <>
            <span aria-hidden="true" className="font-mono text-2xl font-bold text-ink-muted">
              -
            </span>
            <span className="sr-only">{missing ?? "Not available"}</span>
          </>
        ) : (
          <span className={`block break-words font-mono text-2xl font-bold leading-tight tabular-nums ${tone}`}>
            {value}
          </span>
        )}
        {sub && <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">{sub}</span>}
      </dd>
    </div>
  );
}

/** One argument card. Icon and accent are decoration; the title carries it. */
function RationaleCard({ point }: { point: RationalePoint }) {
  const t = TONE[point.tone];
  const Icon = t.icon;
  return (
    <li
      className={`flex gap-3 rounded-card border border-line border-l-2 ${t.border} bg-base/40 p-3`}
    >
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-card border ${t.icon_bg}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug text-ink">{point.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{point.body}</p>
      </div>
    </li>
  );
}

const POSITION_PLURAL: Record<string, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

/**
 * Season-end positional finishes, newest first.
 *
 * "WR6" is the shorthand a fantasy player reads at a glance and a screen reader
 * pronounces as "W R 6", so the chip and the spoken sentence are separate
 * strings: the chip is aria-hidden and each list item carries its own sr-only
 * sentence. That is deliberately NOT an aria-label on the list item. Naming a
 * bare `listitem` is legal ARIA and among the least reliably supported cases in
 * it, and if the name were ignored here every child is hidden, so the whole
 * history would announce as three empty rows.
 *
 * role="list" is required, not redundant: the Tailwind preflight sets
 * list-style:none, which is what makes Safari and VoiceOver drop list semantics.
 */
function FinishStrip({
  position,
  finishes,
  scoringLabel,
}: {
  position: string;
  finishes: SeasonFinish[];
  scoringLabel?: string;
}) {
  const plural = POSITION_PLURAL[position] ?? "players";
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Season finishes{scoringLabel ? `, ${scoringLabel} scoring` : ""}
      </p>
      <ol role="list" className="mt-2 flex flex-wrap gap-2">
        {finishes.map((f) => (
          <li
            key={f.season}
            className="min-w-0 rounded-card border border-line bg-surface px-2.5 py-1.5 text-center"
          >
            <span aria-hidden="true" className="block text-[11px] font-semibold text-ink-muted">
              {f.season}
            </span>
            <span
              aria-hidden="true"
              className="mt-0.5 block font-mono text-base font-bold tabular-nums text-brand-cyan"
            >
              {position}
              {f.finish}
            </span>
            <span className="sr-only">
              {`In ${f.season} he finished number ${f.finish} of ${f.playersRanked} ${plural}.`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The steal read, when the nightly build is confident enough to say it.
 *
 * A "fade" is the market being HIGHER on him than we are, so it gets its own
 * icon and tone. Sparkles on a warning would read as a recommendation to a
 * sighted user, which is the one group the verdict sentence does not fully
 * protect (a listener hears the whole sentence either way).
 */
function StealBadge({ verdict, category }: { verdict: string; category: string }) {
  const positive = category === "steal" || category === "swing";
  const Icon = positive ? Sparkles : TrendingDown;
  return (
    <p
      className={`inline-flex max-w-full items-start gap-1.5 rounded-card border px-2.5 py-1.5 text-xs font-semibold leading-snug ${
        positive
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-200"
      }`}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{verdict}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// The spotlight
// ---------------------------------------------------------------------------

export function PlayerSpotlight({
  data,
  variant,
  rationale = [],
  caveat = null,
  finishes = [],
  finishScoringLabel,
  finishesLoading = false,
}: { data: RecommendationCardData; variant: Variant } & SpotlightExtras) {
  const v = VARIANT[variant];
  const Icon = v.icon;
  const p = data.player;
  const heading = data.title ?? v.label;

  // Player name + the small info line (position, team, overall, exp, age). Shared
  // so it can sit beside the headshot on mobile and inside the right column on
  // desktop without duplicating the markup.
  //
  // The sr-only prefix on the heading is what makes the two cards tellable
  // apart in a heading list. Without it, tabbing by heading gives "Garrett
  // Wilson", "Breece Hall", and no clue which one is the value pick and which
  // is the roster pick. The visible badge above carries the same words, so it
  // is aria-hidden and this is the single announcement.
  const identity = p && (
    <>
      <h3 className="text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl">
        <span className="sr-only">{heading}: </span>
        {p.name}
      </h3>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-muted">
        <span className="font-semibold text-ink">{p.position}</span>
        {p.team && <span>, {p.team}</span>}
        <span>, Overall #{p.overallRank}</span>
        {typeof p.yearsExperience === "number" && (
          <span>, {p.yearsExperience === 0 ? "Rookie" : `${p.yearsExperience} yr exp`}</span>
        )}
        {typeof p.age === "number" && <span>, Age {(p.ageDecimal ?? p.age).toFixed(1)}</span>}
      </p>
    </>
  );

  // The market comparison under the ADP tile. beacon_pick is already on the
  // market's own pick scale, so the two numbers are comparable; overall rank is
  // not, and is deliberately not used here.
  // Zero and NaN are absences, not draft slots. lib/on-the-clock/adp.ts rejects
  // them the same way, and a bare typeof check rendered "pick 0".
  const usable = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  const adp = usable(p?.adp);
  const beaconPick = usable(p?.beaconPick);
  const adpSub =
    adp !== null && beaconPick !== null
      ? `We take him at ${Math.round(beaconPick)}`
      : adp !== null
        ? "Market draft slot"
        : null;

  const beatRate = typeof p?.beatRate === "number" ? p.beatRate : null;
  const ppw = typeof p?.projPointsPerWeek === "number" ? p.projPointsPerWeek : null;
  const seasonPoints = typeof p?.projSeasonPoints === "number" ? p.projSeasonPoints : null;

  const showSteal =
    p?.stealVerdict &&
    typeof p.stealConfidence === "number" &&
    p.stealConfidence >= 0.5 &&
    p.stealCategory !== "fair";

  return (
    <article
      aria-label={`${heading}. ${p ? p.name : "No recommendation yet"}`}
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
          {/* Hidden from AT only when there is a heading below repeating it. */}
          <p
            aria-hidden={p ? "true" : undefined}
            className={`text-sm font-bold uppercase tracking-wide ${v.accent}`}
          >
            {heading}
          </p>
          <p className="text-[11px] text-ink-muted">{v.sub}</p>
        </div>
      </div>

      {!p ? (
        <p className="mt-5 text-sm leading-relaxed text-ink-muted">
          We will tailor this the moment we can detect your team or you make your first pick.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* On mobile the headshot and the name/info share one row to save
              vertical space. On desktop this wrapper collapses (display:contents)
              so the headshot becomes a direct flex child and the name/info move
              into the right column, leaving the desktop layout unchanged. */}
          <div className="flex items-center gap-4 sm:contents">
            {/* Headshot, framed. The photo fills the rounded square edge to edge:
                the scoped overrides drop the shared headshot's circular shape and
                inner border so the image (clipped by overflow-hidden) sits flush
                to the frame's rounded corners. */}
            {/* Decorative: PlayerHeadshot's alt is the player's name, which is
                the h3 sitting one node away. Hiding the frame stops "Garrett
                Wilson, image" landing right before "Garrett Wilson, heading". */}
            <div
              aria-hidden="true"
              className="relative shrink-0 self-start overflow-hidden rounded-modal border border-line bg-base [&_img]:rounded-none [&_img]:border-0 [&_span]:rounded-none [&_span]:border-0 [&_img]:!size-[5.5rem] [&_span]:!size-[5.5rem] sm:[&_img]:!size-24 sm:[&_span]:!size-24"
              style={{ boxShadow: "0 0 40px -20px rgba(168, 85, 247, 0.6)" }}
            >
              <PlayerHeadshot sleeperId={p.sleeperId} name={p.name} position={p.position} size={96} />
            </div>
            {/* Name + info, mobile placement (beside the headshot). */}
            <div className="min-w-0 flex-1 sm:hidden">{identity}</div>
          </div>

          <div className="min-w-0 flex-1">
            {/* Name + info, desktop placement (top of the right column). */}
            <div className="hidden sm:block">{identity}</div>

            {/* The stat rail. Two columns on a phone, three from small up, so
                every number stays on screen at every width rather than any of
                them being hidden behind a breakpoint. */}
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat
                label="FF Beacon value"
                shortLabel="FFB Value"
                value={p.value.toLocaleString()}
                emphasis="purple"
              />
              <Stat label="Pos rank" value={`${p.position}${p.positionRank}`} sub={`Tier ${p.tier}`} />
              <Stat
                label="Projected"
                value={ppw !== null ? ppw.toFixed(1) : null}
                sub={
                  ppw !== null
                    ? seasonPoints !== null
                      ? `Points a week, ${Math.round(seasonPoints)} points left this season`
                      : "Points a week"
                    : null
                }
                missing="No weekly projection published for this player"
                emphasis="cyan"
              />
              <Stat
                label="Beats projection"
                shortLabel="Beat rate"
                value={beatRate !== null ? `${Math.round(beatRate * 100)}%` : null}
                sub={
                  beatRate !== null && typeof p.accuracyWeeks === "number" && p.accuracyWeeks > 0
                    ? `Of ${p.accuracyWeeks} graded weeks`
                    : beatRate !== null
                      ? "Of his graded weeks"
                      : null
                }
                missing="Not enough graded weeks to measure how often he beats his projection"
              />
              <Stat
                label="Market ADP"
                value={adp !== null ? adp.toFixed(1) : null}
                sub={adpSub}
                missing="No draft-market data for this player"
              />
              <Stat
                label="On the field"
                value={
                  typeof p.availability === "number" ? `${Math.round(p.availability * 100)}%` : null
                }
                sub={
                  typeof p.availability === "number"
                    ? "Of the weeks he was projected to play"
                    : null
                }
                missing="No availability history for this player"
              />
            </dl>

            <div className="mt-3 flex flex-wrap items-start gap-2">
              {data.filledSlot && (
                <p className="inline-flex items-center gap-1 rounded-full border border-brand-cyan/40 px-2.5 py-1 text-xs font-semibold text-brand-cyan">
                  Fills your open {data.filledSlot} slot
                </p>
              )}
              {showSteal && p.stealVerdict && (
                <StealBadge verdict={p.stealVerdict} category={p.stealCategory ?? ""} />
              )}
            </div>

            {/* The headline call, then the argument behind it. */}
            <p className="mt-3 text-sm font-medium leading-relaxed text-ink">{data.reason}</p>
            {p.shortNote && <p className="mt-1.5 text-xs italic text-ink-muted">{p.shortNote}</p>}

            {/* A plain div, not a labelled <section>. A named section becomes a
                landmark region, and two spotlights would add two of them inside
                the one this page already has, each announcing a name that the
                h4 immediately below then repeats in different words. */}
            {rationale.length > 0 && (
              <div className="mt-4">
                <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
                  <Lightbulb aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
                  Why we are calling this pick
                </h4>
                <ul role="list" className="mt-2 grid gap-2 lg:grid-cols-2">
                  {rationale.map((point) => (
                    <RationaleCard key={point.id} point={point} />
                  ))}
                </ul>
              </div>
            )}

            {finishes.length > 0 ? (
              <div className="mt-3">
                <FinishStrip
                  position={p.position}
                  finishes={finishes}
                  scoringLabel={finishScoringLabel}
                />
              </div>
            ) : finishesLoading ? (
              // Deliberately NOT a live region. This card recomputes on every
              // pick in the room, so an announcement here would fire dozens of
              // times a draft and talk over the alert announcer, which is the
              // one carrying a clock. The history is optional and the card is
              // complete without it.
              <p className="mt-3 text-xs text-ink-muted">Loading season finishes...</p>
            ) : null}

            {caveat && (
              <p className="mt-3 flex items-start gap-2 rounded-card border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-semibold">Worth knowing. </span>
                  {caveat}
                </span>
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
