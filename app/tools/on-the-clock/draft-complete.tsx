"use client";

/**
 * What the "who to pick" view becomes once there is nobody left to pick.
 *
 * THE PROBLEM
 * The recommendation surface kept rendering after the last pick: two spotlight
 * cards reasoning about a board with nothing on it, under a heading that says
 * "Who to pick right now". It reads as broken, and it leaves the reader at a
 * dead end at the exact moment they are most engaged with their team.
 *
 * WHAT IT DOES INSTEAD
 * Reports the draft, then hands the reader to League Pulse. That handoff is the
 * point of the screen, not decoration on it: the roster they just spent two
 * hours building becomes a real team the moment the draft locks, and League
 * Pulse is where that team lives all season. A drafter who closes this tab and
 * never comes back was ours to keep.
 *
 * LAYOUT: FOUR BANDS, IN THE ORDER A DRAFTER READS THEM.
 * A hero carrying the one figure they came back for (the grade, set at display
 * size in the beacon gradient), the supporting numbers as icon tiles, the ways
 * back into the draft, and then the League Pulse handoff, which is deliberately
 * the largest and loudest thing on the screen. Bands two and three use the
 * cockpit's own `Panel` rather than a local imitation of it, so the completion
 * screen inherits the beacon hairline, the eyebrow, and the tinted header band
 * every other section of the room already wears, and can never drift from them.
 *
 * EVERY NUMBER HERE IS ALREADY COMPUTED. The grade, the rank, the Draft Pulse
 * score, the best and worst pick all come from the props the cockpit already
 * holds. Nothing here fetches, and nothing here recomputes: a completed draft is
 * frozen by design (lib/on-the-clock/draft-snapshot.ts) and this must not be the
 * thing that thaws it.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  Award,
  BarChart3,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  Gauge,
  Medal,
  Radar,
  Repeat,
  ShieldAlert,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { DraftGrade } from "@/lib/on-the-clock/draft-grade";
import type { DraftPulseTeam } from "@/lib/on-the-clock/draft-pulse";
import { Panel } from "./panel";

/** The views this screen links out to. Must exist in the cockpit's VIEWS list. */
export type DraftCompleteView = "grades" | "rankings" | "rosters" | "history";

/** The beacon, as a value, for the two places type is painted with it. */
const BEACON_GRADIENT = "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)";

/** The hairline every panel in the cockpit wears along its top edge. */
const BEACON_HAIRLINE =
  "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)";

export interface DraftCompleteProps {
  leagueName: string;
  season: number | string;
  /** Sleeper league id, for the League Pulse links. */
  sleeperLeagueId: string | null;
  /** The reader's own grade, when we know which roster is theirs. */
  myGrade: DraftGrade | null;
  /** The reader's own Draft Pulse row. */
  myPulse: DraftPulseTeam | null;
  /** How many teams were in the room, for the rank sentences. */
  teamCount: number;
  /**
   * Move the cockpit to another view. Typed as the cockpit's own View union via
   * the caller rather than redeclared here, so a renamed view is a compile
   * error instead of a dead button.
   */
  onGoToView: (view: DraftCompleteView) => void;
  /**
   * How many of the reader's players have picked up a new injury designation
   * since the draft locked. Null when we cannot tell, which is not zero.
   */
  changedSinceDraft: number | null;
}

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

type TileAccent = "cyan" | "purple" | "warning";

const TILE_ACCENT: Record<TileAccent, string> = {
  cyan: "border-brand-cyan/40 text-brand-cyan",
  purple: "border-brand-purple/40 text-brand-purple",
  warning: "border-signal-warning/40 text-signal-warning",
};

/**
 * One headline figure. The label sits beside its icon, the figure is set large
 * enough to carry the tile on its own, and the detail line underneath supplies
 * the context that turns the figure into a sentence for a screen reader.
 *
 * `wide` drops the figure two sizes. A player name is not a number, and setting
 * one at 36px wraps it to three lines on a phone.
 */
function Tile({
  icon: Icon,
  label,
  value,
  detail,
  accent = "cyan",
  wide = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string | null;
  accent?: TileAccent;
  wide?: boolean;
}) {
  return (
    <div className="rounded-card border border-line-accent bg-base/60 p-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-card border bg-surface ${TILE_ACCENT[accent]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
          {label}
        </p>
      </div>
      <p
        className={`mt-3 font-bold leading-tight tracking-tight text-ink ${
          wide
            ? "break-words text-lg sm:text-xl"
            : "text-3xl tabular-nums sm:text-4xl"
        }`}
      >
        {value}
      </p>
      {detail ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

/** One thing League Pulse does, in the section that sells it. */
function PulseFeature({
  icon: Icon,
  name,
  body,
}: {
  icon: LucideIcon;
  name: string;
  body: string;
}) {
  return (
    <li className="rounded-card border border-line-accent bg-base/70 p-4">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-card border border-brand-cyan/40 bg-surface text-brand-cyan"
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <p className="mt-3 text-sm font-bold tracking-tight text-ink">{name}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

/**
 * What League Pulse gives a drafter the morning after. Every entry names a real
 * route under /leagues/[id] and describes work that already runs there. Nothing
 * here is aspirational: a promise this screen cannot keep is worse than silence.
 */
const PULSE_FEATURES: Array<{ icon: LucideIcon; name: string; body: string }> =
  [
    {
      icon: Gauge,
      name: "Power Pulse",
      body: "A projected record, playoff odds and a title chance for every team, simulated off the schedule you actually have left.",
    },
    {
      icon: Activity,
      name: "Positional WAR",
      body: "One curve per position showing where the talent runs out in your league, so you know which slot is worth paying up for.",
    },
    {
      icon: ArrowLeftRight,
      name: "Trade Ideas",
      body: "Build any deal and see it graded twice, on value and on wins, because those two answers routinely disagree.",
    },
    {
      icon: CalendarRange,
      name: "Schedules",
      body: "Every matchup, both starting lineups, and the projected total behind each side of it.",
    },
    {
      icon: Medal,
      name: "Power rankings",
      body: "Every roster priced asset by asset, draft picks included, and ranked against the rest of the room.",
    },
    {
      icon: Radar,
      name: "Transactions",
      body: "Every add, drop and trade in the league as it lands, with each trade carrying its own verdict.",
    },
  ];

/** The four ways back into the draft that just finished. */
const LOOK_BACK: Array<{
  view: DraftCompleteView;
  label: string;
  detail: string;
  Icon: LucideIcon;
}> = [
  {
    view: "grades",
    label: "Full grades",
    detail: "Every team, scored component by component.",
    Icon: BarChart3,
  },
  {
    view: "rankings",
    label: "Awards",
    detail: "Who won what in the room.",
    Icon: Trophy,
  },
  {
    view: "rosters",
    label: "Rosters",
    detail: "The whole league, side by side.",
    Icon: TrendingUp,
  },
  {
    view: "history",
    label: "Trade history",
    detail: "Every deal that changed hands.",
    Icon: Repeat,
  },
];

export function DraftComplete({
  leagueName,
  season,
  sleeperLeagueId,
  myGrade,
  myPulse,
  teamCount,
  onGoToView,
  changedSinceDraft,
}: DraftCompleteProps) {
  const leagueHref = sleeperLeagueId ? `/leagues/${sleeperLeagueId}` : null;

  /* Anything we do not know is left out rather than shown as a dash: a missing
     grade means the room could not be graded, and a placeholder would imply a
     zero. The whole panel is dropped when none of the tiles survive. */
  const tiles: ReactNode[] = [];
  if (myGrade) {
    tiles.push(
      <Tile
        key="score"
        icon={Award}
        label="Composite score"
        value={String(Math.round(myGrade.score))}
        detail={`Out of 100, curved inside this league. ${ordinal(myGrade.rank)} of ${teamCount}.`}
        accent="purple"
      />,
    );
  }
  if (myPulse) {
    tiles.push(
      <Tile
        key="lineup"
        icon={Gauge}
        label="Projected starters"
        value={myPulse.meanStartingPoints.toFixed(1)}
        detail={`Points a week from your best lineup. ${ordinal(myPulse.rank)} in the league.`}
      />,
    );
  }
  if (myGrade?.bestPick) {
    tiles.push(
      <Tile
        key="best"
        icon={Star}
        label="Your best pick"
        value={myGrade.bestPick.playerName}
        detail={`Taken at ${myGrade.bestPick.pickNo}, ahead of what the market said that slot was worth.`}
        wide
      />,
    );
  }
  if (myGrade?.worstPick) {
    tiles.push(
      <Tile
        key="worst"
        icon={TrendingDown}
        label="Your steepest reach"
        value={myGrade.worstPick.playerName}
        detail={`Taken at ${myGrade.worstPick.pickNo}, above the market price for that slot.`}
        accent="warning"
        wide
      />,
    );
  }
  if (myGrade?.biggestHole) {
    tiles.push(
      <Tile
        key="hole"
        icon={Target}
        label="Thinnest slot"
        value={myGrade.biggestHole}
        detail="The starting slot still costing you the most every week."
        accent="warning"
        wide
      />,
    );
  }
  if (myPulse && myPulse.unprojectedCount > 0) {
    tiles.push(
      <Tile
        key="coverage"
        icon={ClipboardList}
        label="Projection coverage"
        value={`${myPulse.projectedCount} of ${
          myPulse.projectedCount + myPulse.unprojectedCount
        }`}
        detail="Players on your roster carrying a weekly projection. The rest sit outside the lineup maths."
        wide
      />,
    );
  }

  return (
    <section aria-labelledby="otc-draft-complete-title" className="space-y-5">
      {/* ---- 1. THE HERO. The grade, at the size the grade deserves. ---- */}
      <div
        className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/50 p-5 sm:p-7"
        style={{ boxShadow: "0 0 90px -50px rgba(168, 85, 247, 0.6)" }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ backgroundImage: BEACON_HAIRLINE }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.16) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.14) 0%, transparent 62%)",
          }}
        />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
              >
                <Trophy className="h-3.5 w-3.5" />
              </span>
              Draft complete
            </p>
            <h2
              id="otc-draft-complete-title"
              className="mt-3 text-2xl font-bold leading-tight tracking-tight text-ink sm:text-4xl"
            >
              Your draft is in the books
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {leagueName}, {season}, {teamCount} teams. There is nobody left to
              pick, so here is how it went.
            </p>
          </div>

          {myGrade ? (
            <div className="shrink-0 rounded-modal border border-brand-purple/40 bg-base/70 px-6 py-4 text-center sm:min-w-[178px]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                Your draft grade
              </p>
              <p
                className="mt-1 bg-clip-text text-6xl font-bold leading-none tracking-tight text-transparent sm:text-7xl"
                style={{ backgroundImage: BEACON_GRADIENT }}
              >
                {myGrade.letter}
              </p>
              <p className="mt-2 text-xs text-ink-muted">
                {ordinal(myGrade.rank)} of {teamCount} in the room
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* ---- 2. THE SUPPORTING NUMBERS ---- */}
      {tiles.length > 0 ? (
        <Panel
          eyebrow="Your draft"
          title="The numbers behind the grade"
          helper="Every figure below is measured against the other teams in this room, not against fantasy football at large."
          headingLevel={3}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles}
          </div>

          {myGrade?.review ? (
            <div className="mt-4 rounded-card border border-line-accent bg-base/60 p-4">
              <p className="flex items-center gap-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-purple">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-card border border-brand-purple/40 bg-surface"
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                </span>
                The read on your draft
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink">
                {myGrade.review}
              </p>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {/* ---- 3. THE WAYS BACK IN ---- */}
      <Panel
        eyebrow="The room"
        title="Look back at the draft"
        helper="Four views of the two hours you just spent, all built from the frozen board."
        headingLevel={3}
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          {LOOK_BACK.map(({ view, label, detail, Icon }) => (
            <button
              key={view}
              type="button"
              onClick={() => onGoToView(view)}
              className="group flex min-h-11 items-center gap-3 rounded-card border border-line-accent bg-base/60 px-4 py-3.5 text-left transition-colors hover:border-brand-cyan/60 hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-surface text-brand-cyan"
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">
                  {label}
                </span>
                <span className="block text-xs leading-relaxed text-ink-muted">
                  {detail}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-ink-subtle transition-colors group-hover:text-brand-cyan"
              />
            </button>
          ))}
        </div>
      </Panel>

      {/* ---- 4. THE HANDOFF. The reason this screen exists, and by some
              distance the biggest thing on it. ---- */}
      <section
        aria-labelledby="otc-draft-complete-pulse-title"
        className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-surface/40 p-5 sm:p-8"
        style={{
          boxShadow: "0 0 130px -55px rgba(168, 85, 247, 0.8)",
          backgroundImage:
            "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.22) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.18) 0%, transparent 60%), radial-gradient(ellipse at 50% 130%, rgba(124, 58, 237, 0.20) 0%, transparent 62%)",
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
          style={{ backgroundImage: BEACON_HAIRLINE }}
        />

        <div className="relative">
          <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            <span
              aria-hidden="true"
              className="pointer-events-none h-4 w-1 shrink-0 rounded-full bg-beacon"
            />
            Continue your journey with
          </p>
          <h3
            id="otc-draft-complete-pulse-title"
            className="mt-2 bg-clip-text text-3xl font-bold leading-none tracking-tight text-transparent sm:text-5xl"
            style={{ backgroundImage: BEACON_GRADIENT }}
          >
            League Pulse
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
            Your draft board is a real team now. League Pulse reads that roster
            every week and answers what the draft could not: how many games it
            wins from here, which positions are still worth paying for, and
            whether the trade sitting in your inbox actually helps.
          </p>

          <ul
            role="list"
            className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {PULSE_FEATURES.map((feature) => (
              <PulseFeature key={feature.name} {...feature} />
            ))}
          </ul>

          {/* Says what changed since the draft, when we can tell. This is the
              sentence that earns the click: a reader who knows one of their
              players is now on IR has a reason to open the page today rather
              than in September. */}
          {changedSinceDraft !== null && changedSinceDraft > 0 ? (
            <p className="mt-6 flex items-start gap-3 rounded-card border border-signal-warning/50 bg-signal-warning/10 p-4 text-sm leading-relaxed text-ink">
              <ShieldAlert
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-signal-warning"
              />
              <span>
                <span className="font-bold">
                  {changedSinceDraft} of your players{" "}
                  {changedSinceDraft === 1 ? "has" : "have"} a new injury
                  designation since you drafted.
                </span>{" "}
                League Pulse already accounts for it.
              </span>
            </p>
          ) : null}

          <div className="mt-7 flex flex-col gap-3 border-t border-line-accent pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href={leagueHref ?? "/tools/league-pulse"}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-card bg-beacon px-6 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:text-base"
            >
              {leagueHref
                ? `Open ${leagueName} in League Pulse`
                : "Find your league in League Pulse"}
              <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
            </Link>
            <p className="text-xs leading-relaxed text-ink-subtle sm:max-w-xs sm:text-right">
              {leagueHref
                ? "Opens straight to this league. Nothing to set up."
                : "Enter the Sleeper username you drafted with and it loads from there."}
            </p>
          </div>
        </div>
      </section>
    </section>
  );
}
