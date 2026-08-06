/**
 * The payoff sections beneath the table: the Quick Takeaways grid (scannable
 * plain-English answers to the questions a casual manager actually asks) and
 * the featured Beacon Verdict card (the one-sentence bottom line). Server
 * components.
 */

import {
  CalendarClock,
  Rocket,
  ShieldCheck,
  Target,
  Zap,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { CopyLinkButton } from "@/components/copy-link-button";
import type { BreakdownPlayer, EdgeWinner, Takeaway } from "@/lib/beacon-breakdown";

const TAKEAWAY_ICON: Record<string, LucideIcon> = {
  "long-term": CalendarClock,
  "win-now": Zap,
  floor: ShieldCheck,
  upside: Rocket,
  "trade-target": Target,
};

export function QuickTakeaways({
  a,
  b,
  takeaways,
}: {
  a: BreakdownPlayer;
  b: BreakdownPlayer;
  takeaways: Takeaway[];
}) {
  return (
    <section aria-labelledby="takeaways-heading">
      <h2
        id="takeaways-heading"
        className="text-lg font-semibold tracking-tight text-ink sm:text-xl"
      >
        Quick Takeaways
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        The plain-English answers, no table-reading required.
      </p>
      <ul role="list" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {takeaways.map((t) => (
          <TakeawayCard key={t.key} takeaway={t} a={a} b={b} />
        ))}
      </ul>
    </section>
  );
}

function TakeawayCard({
  takeaway,
  a,
  b,
}: {
  takeaway: Takeaway;
  a: BreakdownPlayer;
  b: BreakdownPlayer;
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
        <WinnerPill winner={takeaway.winner} a={a} b={b} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{takeaway.detail}</p>
    </li>
  );
}

function WinnerPill({
  winner,
  a,
  b,
}: {
  winner: EdgeWinner;
  a: BreakdownPlayer;
  b: BreakdownPlayer;
}) {
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
  const name = winner === "a" ? a.name : b.name;
  const tone =
    winner === "a"
      ? "border-brand-purple/50 bg-brand-purple/10 text-brand-purple"
      : "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      <span aria-hidden="true">◆</span>
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
