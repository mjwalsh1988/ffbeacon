/**
 * The waiver board's right-hand rail: the controls and the small print.
 *
 * WHY THESE MOVED OUT OF THE MAIN COLUMN. The board used to open with a row of
 * filter chips, then a five-line grey box of assumptions, then a status line,
 * and only then a player. Three blocks of furniture between a reader and the
 * thing they came for, and all three are reference material they consult once
 * and then ignore. In the rail they are permanently visible on a wide screen,
 * out of the way of the scroll, and they fall BELOW the board on a phone, which
 * is where supplementary content belongs.
 *
 * `PageColumns` puts the rail second in DOM order for the same reason, so a
 * screen reader reaches the players before the methodology.
 *
 * EVERY CONTROL IS A LINK. Position filtering and the week picker are anchors
 * carrying real URLs, so both work with scripting off, both are shareable, both
 * are back-button-correct, and a crawler finds them. `aria-current="page"`
 * marks the live one, the same semantic the site's navigation uses.
 *
 * Presentational server components.
 */

import { OFFENSE_POSITIONS, positionNounMap, type IdpPosition } from "@/lib/site";
import Link from "next/link";
import { CalendarDays, Info, ListFilter, Wallet } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { formatEastern } from "@/lib/datetime";
import { boardWeeks, weekPath, weekPhase } from "@/lib/waiver-wire/weeks";
import { BOARD_POSITIONS, type BoardPosition, type WaiverBoard } from "@/lib/waiver-wire/types";

const POSITION_WORD: Record<BoardPosition, string> = positionNounMap(OFFENSE_POSITIONS, {
  form: "plural",
  short: ["DEF"],
});

const POSITION_TEXT: Record<BoardPosition | IdpPosition, string> = {
  QB: "text-position-qb",
  RB: "text-position-rb",
  WR: "text-position-wr",
  TE: "text-position-te",
  K: "text-position-k",
  DEF: "text-position-def",
  DL: "text-position-dl",
  LB: "text-position-lb",
  DB: "text-position-db",
};

/**
 * The position filter, as a list rather than a chip row.
 *
 * A list in a narrow rail can carry the COUNT beside every position without
 * wrapping, which the chip row could not. The count is the useful half: "19
 * running backs, 4 tight ends" tells a reader where this week's depth actually
 * is before they click anything.
 */
export function PositionRail({
  basePath,
  active,
  counts,
  total,
}: {
  basePath: string;
  active: BoardPosition | null;
  counts: Map<BoardPosition, number>;
  total: number;
}) {
  const rowBase =
    "flex min-h-11 items-center justify-between gap-3 rounded-card border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
  const on = "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan";
  const off =
    "border-transparent text-ink-muted hover:border-line-accent hover:bg-ink/[0.04] hover:text-ink";

  return (
    <Panel
      eyebrow="Filter"
      title="By position"
      headingLevel={2}
      bodyClassName="p-2"
    >
      <nav aria-label="Filter the board by position">
        <ul role="list" className="space-y-0.5">
          <li>
            <Link
              href={basePath}
              aria-current={active == null ? "page" : undefined}
              className={`${rowBase} ${active == null ? on : off}`}
            >
              <span className="flex items-center gap-2">
                <ListFilter aria-hidden="true" className="h-3.5 w-3.5" />
                All positions
              </span>
              <span className="font-mono text-xs tabular-nums text-ink-subtle">
                {total}
                <span className="sr-only"> players worth a claim</span>
              </span>
            </Link>
          </li>
          {BOARD_POSITIONS.filter((p) => (counts.get(p) ?? 0) > 0).map((position) => (
            <li key={position}>
              <Link
                href={`${basePath}?pos=${position}`}
                aria-current={active === position ? "page" : undefined}
                className={`${rowBase} ${active === position ? on : off}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`font-mono text-xs font-bold ${POSITION_TEXT[position]}`}>
                    {position}
                  </span>
                  <span className="capitalize">{POSITION_WORD[position]}</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-ink-subtle">
                  {counts.get(position)}
                  <span className="sr-only"> available</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Panel>
  );
}

/** The week picker, as a compact grid of numbers. */
export function WeekRail({
  week,
  currentWeek,
  season,
}: {
  /** The week being shown, or null on the hub, where none is selected. */
  week: number | null;
  currentWeek: number;
  season: number | null;
}) {
  const weeks = boardWeeks(currentWeek);
  return (
    <Panel
      eyebrow={season ? `${season} season` : "Season"}
      title="Every week"
      helper="Past weeks stay up, so a link shared on the Tuesday keeps working."
      headingLevel={2}
      bodyClassName="p-3"
    >
      <nav aria-label={`Waiver wire by week${season ? `, ${season} season` : ""}`}>
        <ul role="list" className="grid grid-cols-5 gap-1.5">
          {weeks.map((w) => {
            const phase = weekPhase(w, currentWeek);
            const active = w === week;
            const tone = active
              ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
              : phase === "past"
                ? "border-line bg-base/50 text-ink-subtle hover:border-line-accent hover:text-ink-muted"
                : phase === "current"
                  ? "border-brand-purple/40 bg-brand-purple/10 text-brand-purple hover:border-brand-purple/70"
                  : "border-line bg-surface/60 text-ink-muted hover:border-line-accent hover:text-ink";
            return (
              <li key={w}>
                <Link
                  href={weekPath(w)}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-11 items-center justify-center rounded-card border font-mono text-sm font-semibold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${tone}`}
                >
                  {w}
                  <span className="sr-only">
                    {" "}
                    Week {w}
                    {phase === "past"
                      ? ", already played"
                      : phase === "current"
                        ? ", this week"
                        : ", next week"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </Panel>
  );
}

/** The calculator pitch. The one thing the board cannot do for a reader. */
export function CalculatorRail() {
  return (
    <div
      className="rounded-modal p-px"
      style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
    >
      <div className="rounded-modal p-4" style={{ background: "#16162A" }}>
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
          <Wallet aria-hidden="true" className="h-3.5 w-3.5" />
          Your league, not a standard one
        </p>
        <h2 className="mt-2 text-base font-bold tracking-tight text-ink">
          Price a claim properly
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          Every bid here assumes a 12-team league and a neutral level of need. Connect your
          Sleeper league and the calculator prices the claim against who you would actually
          drop and what your rivals can still spend.
        </p>
        <Link
          href="/tools/faab"
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-base transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Open the FAAB calculator
        </Link>
      </div>
    </div>
  );
}

/**
 * What the bids were priced against, and where the availability figure comes
 * from.
 *
 * Still says everything the old in-flow block said, including the population
 * the rostered percentage describes and the fact that our leagues are
 * self-selected. It is reference material, so it sits in the rail rather than
 * between the reader and the board, and it is not a `<details>`: a caveat a
 * reader has to open is a caveat most readers never see.
 */
export function MethodRail({ board }: { board: WaiverBoard }) {
  const a = board.assumptions;
  return (
    <Panel
      eyebrow="Method"
      title="How these numbers are built"
      headingLevel={2}
      bodyClassName="px-4 py-3.5"
    >
      <dl className="space-y-3 text-sm leading-relaxed">
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-purple">
            <Wallet aria-hidden="true" className="h-3 w-3" />
            The bids
          </dt>
          <dd className="mt-1 text-ink-muted">
            Priced for a {a.teams}-team league starting {a.offensiveStarters} with a $
            {a.budget} season budget and a neutral level of need, so a dollar figure is also a
            percentage of whatever you have left.
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-purple">
            <Info aria-hidden="true" className="h-3 w-3" />
            The points
          </dt>
          <dd className="mt-1 text-ink-muted">
            {a.formatName} scoring from the {a.projectionSourceName} projections. Player values
            come from {a.sourceName}.
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-purple">
            <CalendarDays aria-hidden="true" className="h-3 w-3" />
            The availability
          </dt>
          <dd className="mt-1 text-ink-muted">
            Counted from real synced Sleeper leagues
            {board.rosterRatesComputedAt
              ? `, last rebuilt ${formatEastern(board.rosterRatesComputedAt)}`
              : ""}
            . Those leagues are ones readers connected themselves, so they skew toward dynasty
            and they are not a sample of Sleeper as a whole. Anyone rostered in{" "}
            {a.availabilityCeilingPct} percent or more is left off, because he is not really a
            waiver claim.
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

/** Where a reader goes after the board. */
export function NextRail({ links }: { links: { href: string; title: string; body: string }[] }) {
  return (
    <Panel eyebrow="Next" title="Once you have picked" headingLevel={2} bodyClassName="p-2">
      <ul role="list" className="space-y-0.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="flex min-h-11 flex-col justify-center rounded-card border border-transparent px-3 py-2 transition-colors hover:border-line-accent hover:bg-ink/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span className="text-sm font-semibold text-ink">{link.title}</span>
              <span className="mt-0.5 text-xs leading-relaxed text-ink-muted">{link.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
