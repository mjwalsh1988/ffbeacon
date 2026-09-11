/**
 * The payoff sections beneath the table, generalised from two players to two
 * to eight: the Quick Takeaways grid (scannable plain-English answers to the
 * questions a casual manager actually asks) and the featured Beacon Verdict
 * card (the one-sentence bottom line). Server components.
 *
 * The old five takeaways (lib/breakdown/verdict.ts buildTakeaways) are a
 * pairwise-only function: they read raw reliability and projection fields off
 * exactly two MetricSide values and do not generalise to N sides, and that
 * file is out of scope for this change (it stays the pairwise engine BEAM
 * depends on, per lib/breakdown/edge.ts's own docs on computeGroupEdge).
 * QuickTakeaways is rebuilt here instead, directly off the active lens's
 * GroupEdge, which is the SAME data the table and the meter render: every
 * sentence below cites a share, weight, or composite that is already on
 * screen. Deviation from the old fixed taxonomy: "Best long-term value" and
 * "Best win-now option" (the two lens composites) collapse into a single
 * "Best overall" card for the ACTIVE lens, because the lens switch already
 * lets a reader flip between them; "Safer floor", "Higher upside" and "Best
 * trade target" are kept, sourced from the same metric keys
 * (consistency/upside/value) the old function used, and now use that
 * metric's rank/isBest across all N sides. A card is omitted, never rendered
 * with an invented answer, when the active lens gives that metric zero
 * weight (e.g. Upside and Best trade target carry no weight under This week),
 * which is the same "a null figure means the sentence does not fire" rule
 * Trade Ideas' reasons follow.
 */

import { useId } from "react";
import {
  Rocket,
  ShieldCheck,
  Target,
  Zap,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { CopyLinkButton } from "@/components/copy-link-button";
import type { BreakdownPlayer, GroupEdge, LensId } from "@/lib/beacon-breakdown";

/** A player index into `sides`, or "even" (a genuine tie), or "na" (not enough data). */
type GroupWinner = number | "even" | "na";

type GroupTakeaway = {
  key: string;
  label: string;
  winner: GroupWinner;
  detail: string;
};

const TAKEAWAY_ICON: Record<string, LucideIcon> = {
  overall: Sparkles,
  drivers: Zap,
  floor: ShieldCheck,
  upside: Rocket,
  value: Target,
};

const LENS_TEXT: Record<LensId, string> = {
  dynasty: "dynasty value",
  "win-now": "the rest of this season",
  "this-week": "this week",
};

/** The side (and whether it is a tie) holding the best scalar for `key`, or null when no side resolved it. */
function findBest(edge: GroupEdge, key: string): { index: number; tie: boolean } | null {
  const hits = edge.sides
    .map((side, index) => ({ index, contribution: side.contributions.find((c) => c.key === key) }))
    .filter((hit): hit is { index: number; contribution: NonNullable<typeof hit.contribution> } =>
      hit.contribution != null,
    );
  if (hits.length === 0) return null;
  const bestHits = hits.filter((hit) => hit.contribution.isBest);
  if (bestHits.length === 0) return null;
  return { index: bestHits[0].index, tie: bestHits.length > 1 };
}

function buildGroupTakeaways(
  sides: BreakdownPlayer[],
  edge: GroupEdge,
  lens: LensId,
): GroupTakeaway[] {
  const out: GroupTakeaway[] = [];
  const lensText = LENS_TEXT[lens];

  // 1. The overall composite leader for the active lens.
  out.push({
    key: "overall",
    label: "Best overall",
    winner: edge.metricsUsed === 0 ? "na" : edge.leader == null ? "even" : edge.leader,
    detail:
      edge.metricsUsed === 0
        ? `We do not hold enough data on this group to grade ${lensText} yet.`
        : edge.leader == null
          ? `This group grades out nearly even for ${lensText}.`
          : `${sides[edge.leader].name} takes ${Math.round((edge.sides[edge.leader]?.composite ?? 0.5) * 100)}% of the composite for ${lensText}.`,
  });

  // 2. What is driving the leader, when there is one.
  if (edge.leader != null) {
    const leaderName = sides[edge.leader].name;
    const drivers = [...(edge.sides[edge.leader]?.contributions ?? [])]
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 2)
      .map((c) => c.label.toLowerCase());
    if (drivers.length > 0) {
      out.push({
        key: "drivers",
        label: "What is driving it",
        winner: edge.leader,
        detail:
          drivers.length === 2
            ? `${leaderName} leads on ${drivers[0]} and ${drivers[1]}.`
            : `${leaderName} leads on ${drivers[0]}.`,
      });
    }
  }

  // 3. Safer floor: week-to-week consistency.
  {
    const found = findBest(edge, "consistency");
    if (found) {
      const weight =
        edge.sides[found.index]?.contributions.find((c) => c.key === "consistency")?.weight ?? 0;
      out.push({
        key: "floor",
        label: "Safer floor",
        winner: found.tie ? "even" : found.index,
        detail: found.tie
          ? "Nobody carries meaningfully less week-to-week risk than the rest of the group."
          : `${sides[found.index].name} is the steadiest weekly hold, carrying ${Math.round(weight * 100)}% of the ${lensText} composite.`,
      });
    }
  }

  // 4. Higher upside, only when the active lens counts it.
  {
    const found = findBest(edge, "upside");
    if (found) {
      out.push({
        key: "upside",
        label: "Higher upside",
        winner: found.tie ? "even" : found.index,
        detail: found.tie
          ? "Ceilings look comparable across the group."
          : `${sides[found.index].name} has the most room to climb from here.`,
      });
    }
  }

  // 5. Best trade target, only when the active lens counts value.
  {
    const found = findBest(edge, "value");
    if (found) {
      out.push({
        key: "value",
        label: "Best trade target",
        winner: found.tie ? "even" : found.index,
        detail: found.tie
          ? "Value is a wash across the group."
          : `${sides[found.index].name} carries the strongest current value.`,
      });
    }
  }

  return out;
}

export function QuickTakeaways({
  sides,
  edge,
  lens,
}: {
  sides: BreakdownPlayer[];
  /** The active lens's group edge; the takeaways below recompute with it. */
  edge: GroupEdge;
  lens: LensId;
}) {
  const takeaways = buildGroupTakeaways(sides, edge, lens);
  // useId, not a literal string: the Head to head tab's lens switch keeps
  // all three lenses' panels mounted at once (only `hidden` toggles), so
  // without a per-instance id three copies of this heading would collide on
  // "takeaways-heading" in the same document.
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="text-lg font-semibold tracking-tight text-ink sm:text-xl"
      >
        Quick Takeaways
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        The plain-English answers, no table-reading required.
      </p>
      <ul role="list" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {takeaways.map((t) => (
          <TakeawayCard key={t.key} takeaway={t} sides={sides} />
        ))}
      </ul>
    </section>
  );
}

function TakeawayCard({
  takeaway,
  sides,
}: {
  takeaway: GroupTakeaway;
  sides: BreakdownPlayer[];
}) {
  const Icon = TAKEAWAY_ICON[takeaway.key] ?? Sparkles;
  return (
    <li className="rounded-card border border-line bg-surface/50 p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm font-semibold text-ink">{takeaway.label}</p>
      </div>
      <div className="mt-3">
        <WinnerPill winner={takeaway.winner} sides={sides} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{takeaway.detail}</p>
    </li>
  );
}

function WinnerPill({ winner, sides }: { winner: GroupWinner; sides: BreakdownPlayer[] }) {
  if (winner === "even") {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-1 text-xs font-medium text-ink-muted">
        Toss-up
      </span>
    );
  }
  if (winner === "na") {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-1 text-xs font-medium text-ink-subtle">
        Not enough data
      </span>
    );
  }
  const name = sides[winner]?.name ?? "Unknown";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-2.5 py-1 text-xs font-semibold text-brand-cyan">
      <span aria-hidden="true">&#9670;</span>
      {name}
    </span>
  );
}

export function VerdictCard({
  verdict,
  shareHref,
}: {
  verdict: string;
  /** The URL this exact comparison lives at, for the copy-link action. */
  shareHref?: string;
}) {
  return (
    <section
      aria-labelledby="verdict-heading"
      className="relative overflow-hidden rounded-modal border border-line bg-surface p-6 sm:p-8"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.14) 0%, transparent 55%)",
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
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
        Beacon Verdict
      </p>
      <h2
        id="verdict-heading"
        className="mt-3 text-xl font-semibold leading-relaxed tracking-tight text-ink sm:text-2xl"
      >
        {verdict}
      </h2>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-subtle">
          Values and ranks reflect your selected format and source. Adjust either from the site
          header to see how the verdict shifts.
        </p>
        {shareHref && (
          <CopyLinkButton
            href={shareHref}
            ariaLabel="Copy a link to this comparison"
            label="Copy link"
            size="sm"
          />
        )}
      </div>
    </section>
  );
}
