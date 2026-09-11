import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowRight,
  ArrowUpDown,
  BookOpen,
  Calculator,
  ChartLine,
  CircleHelp,
  ClipboardList,
  Clock,
  Crosshair,
  Dumbbell,
  Flag,
  Flame,
  Footprints,
  Gauge,
  Goal,
  Hand,
  HeartPulse,
  ListChecks,
  Route,
  ScrollText,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Trophy,
} from "lucide-react";
import { START_SIT_FAQ } from "@/lib/start-sit/copy";
import { MAX_START_SIT_PLAYERS } from "@/lib/start-sit/types";
import { FeatureIconTile, FeatureSectionHeader } from "@/components/feature-section-header";
import { FaqAccordion } from "@/components/faq-accordion";
import { LinkTile } from "@/components/link-tile";

/**
 * The server-rendered prose that carries this page's SEO weight.
 *
 * Every heading and paragraph below ships in the initial HTML: no AI crawler
 * in wide use today executes JavaScript, so anything that only appears after
 * the board hydrates is invisible to them. This component renders the H2s
 * from "How the Beacon Breakdown start/sit verdict is calculated" through
 * "Set your whole lineup, not just one call". The two H2s above it, "Who
 * should I start in Week {N}?" (the board) and "This week's toughest
 * start/sit calls" (the grid), belong to the page and the toughest-calls
 * component.
 *
 * THE DESIGN. Every section opens with FeatureSectionHeader (a large icon
 * tile, an eyebrow, the h2), and the long paragraphs are broken into the
 * shape they already had: four calculation steps become four step cards,
 * the five-sentence method becomes a numbered five-step list, each position
 * becomes its own card with its key factors as chips and its closest calls
 * beside the prose on a wide screen, the FAQ sits beside its heading, and
 * the League Pulse handoff is a call-to-action panel. The WORDS are the ones
 * the SEO build wrote, unchanged except where a paragraph was split at a
 * sentence boundary; the headings, their ids and their order are unchanged,
 * so every in-page link and the FAQPage JSON-LD still match.
 *
 * Icons, the eyebrows, the step watermarks and the position tiles are
 * decorative (aria-hidden). The one visible thing added for a screen reader
 * is the "Step N" prefix inside each step heading, followed by an sr-only
 * colon so the two run as "Step 1: The projection" rather than one word.
 *
 * The positional sections are evergreen on purpose: no claim here names a
 * specific player, team, or fact about the current season. What changes
 * week to week is the "Closest calls" slot beside each one, filled by the
 * toughest-calls component through the closestCalls prop. An empty slot
 * renders nothing at all, heading included, and the prose takes the full
 * width instead.
 */

export type StartSitPositionKey = "QB" | "RB" | "WR" | "TE" | "FLEX" | "K_DEF";

export type WrittenSectionsProps = {
  /** The regular-season week the board is evaluating. */
  week: number;
  season: number;
  /** projectionSourceDisplay() of the resolved slug, e.g. "Sleeper" or "FF Beacon". */
  projectionSourceName: string;
  /** The reader's resolved format, for the rankings links. */
  formatSlug: string;
  formatDisplay: string;
  /**
   * Rendered "Closest calls at {position} this week" content per position,
   * supplied by the toughest-calls component. A missing or falsy entry
   * renders nothing in that position's section: no empty heading.
   */
  closestCalls?: Partial<Record<StartSitPositionKey, ReactNode>>;
};

const LINK_CLASS = "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";

/* ---------- Position metadata ---------- */

type PositionMeta = {
  id: string;
  /** Shown in the decorative tile. */
  abbr: string;
  /** The jump-link label. */
  name: string;
  /** How the factor list is named for a screen reader. */
  factorsLabel: string;
  tile: string;
  dot: string;
  /** A skim-level summary of the paragraph under it: every entry is named there. General advice, not a list of engine inputs. */
  factors: { icon: LucideIcon; label: string }[];
};

const POSITION_ORDER: StartSitPositionKey[] = ["QB", "RB", "WR", "TE", "FLEX", "K_DEF"];

const POSITION_META: Record<StartSitPositionKey, PositionMeta> = {
  QB: {
    id: "start-sit-qb",
    abbr: "QB",
    name: "Quarterback",
    factorsLabel: "Key factors at quarterback",
    tile: "border-position-qb/40 bg-position-qb/15 text-position-qb",
    dot: "bg-position-qb",
    factors: [
      { icon: Activity, label: "Volume" },
      { icon: Shield, label: "Matchup" },
      { icon: Flame, label: "Game environment" },
      { icon: Footprints, label: "Rushing floor" },
    ],
  },
  RB: {
    id: "start-sit-rb",
    abbr: "RB",
    name: "Running back",
    factorsLabel: "Key factors at running back",
    tile: "border-position-rb/40 bg-position-rb/15 text-position-rb",
    dot: "bg-position-rb",
    factors: [
      { icon: Dumbbell, label: "Workload" },
      { icon: Hand, label: "Receiving work" },
      { icon: Flag, label: "Goal-line role" },
      { icon: Shield, label: "Matchup" },
    ],
  },
  WR: {
    id: "start-sit-wr",
    abbr: "WR",
    name: "Wide receiver",
    factorsLabel: "Key factors at wide receiver",
    tile: "border-position-wr/40 bg-position-wr/15 text-position-wr",
    dot: "bg-position-wr",
    factors: [
      { icon: Crosshair, label: "Target share" },
      { icon: Shield, label: "Matchup" },
      { icon: ScrollText, label: "Game script" },
    ],
  },
  TE: {
    id: "start-sit-te",
    abbr: "TE",
    name: "Tight end",
    factorsLabel: "Key factors at tight end",
    tile: "border-position-te/40 bg-position-te/15 text-position-te",
    dot: "bg-position-te",
    factors: [
      { icon: Crosshair, label: "Target share" },
      { icon: Route, label: "Route participation" },
      { icon: Flag, label: "Red-zone role" },
      { icon: Shield, label: "Matchup" },
    ],
  },
  FLEX: {
    id: "start-sit-flex",
    abbr: "FLEX",
    name: "Flex",
    factorsLabel: "Key factors in the flex",
    tile: "border-brand-purple/40 bg-brand-purple/15 text-brand-purple",
    dot: "bg-brand-purple",
    factors: [
      { icon: ChartLine, label: "Projected points" },
      { icon: ArrowUpDown, label: "Floor against ceiling" },
      { icon: Gauge, label: "Confidence" },
    ],
  },
  K_DEF: {
    id: "start-sit-k-def",
    abbr: "K/DEF",
    name: "Defense and kicker",
    factorsLabel: "Key factors at defense and kicker",
    tile: "border-position-k/40 bg-position-k/15 text-position-k",
    dot: "bg-position-k",
    factors: [
      { icon: ScrollText, label: "Game script" },
      { icon: ShieldCheck, label: "Takeaways" },
      { icon: Goal, label: "Field goal volume" },
      { icon: Calculator, label: "Team totals" },
    ],
  },
};

const POSITION_COPY: Record<StartSitPositionKey, { heading: string; body: string }> = {
  QB: {
    heading: "Who should I start at quarterback?",
    body: "Volume decides most quarterback weeks before the matchup does. A quarterback who throws forty times and adds rushing work on top can outscore a tougher matchup through pure opportunity, which is why the projection starts from expected attempts and carries, not from a single highlight-worthy throw. After volume, the tool weighs the matchup: how many points the opposing defense has allowed to the position, adjusted for the offenses that defense actually faced. Game environment matters too. A quarterback expected to trail throws more; one expected to lead runs the clock out and throws less. Rushing floor is usually what separates two similar passers when their passing numbers project close together.",
  },
  RB: {
    heading: "Who should I start at running back?",
    body: "Workload settles most running back decisions. Carries plus targets, not yards per carry, is the strongest predictor of a week's points, so the tool weighs a back's expected touch share ahead of anything about breakaway speed. Matchup counts for less here than reputation suggests: a defense that is stout against the run can still give up a pile of points through the passing game, so a back who catches passes keeps a real floor even against a tough front. Goal-line and short-yardage role adds touchdown equity a pure yardage projection misses, which is why work inside the ten is tracked as its own input rather than folded into one blended rate.",
  },
  WR: {
    heading: "Who should I start at wide receiver?",
    body: "Target share moves a wide receiver's projection more than any other number, because a receiver who sees the ball ten times a game keeps a real floor even on a week the catches go for short gains. After volume, the tool looks at the matchup a receiver actually draws, the gap between a shadow cornerback and a zone look, folded into the defense's points allowed to the position rather than guessed at separately. Game script cuts the other way from running backs: a team expected to trail throws more, which lifts every pass catcher on the roster, including one who would otherwise look like the week's riskier option.",
  },
  TE: {
    heading: "Who should I start at tight end?",
    body: "Target share does the most work at tight end, because touchdown-dependent, boom-or-bust production is what separates a usable weekly starter from a name a reader only half recognizes. The tool leans on route participation and red-zone role ahead of raw catch totals, since a tight end on the field for every pass play keeps a real floor even in a game that never turns into a shootout. Matchup still counts, particularly against a defense that struggles to cover the position out of its base personnel, but the gap between replacement level and the position's best players is unusually wide, so role tends to beat matchup more often here than it does at wide receiver.",
  },
  FLEX: {
    heading: "Who should I start in the flex?",
    body: "A flex spot compares players across positions directly on projected points, which is exactly what this tool does: whichever player projects to score more, once matchup, role, and reliability are folded in, is the better start regardless of position. A running back's weekly floor usually comes from touches guaranteed regardless of how the game unfolds, while a receiver's ceiling usually comes from a matchup or a script that favors the pass, so the flex call is often a trade-off between the two rather than a clear edge for either position. When the projections sit close together, the confidence figure and the reliability numbers are the tiebreaker worth trusting over raw upside.",
  },
  K_DEF: {
    heading: "Who should I start at defense and kicker?",
    body: "Defense and kicker both live and die by game script more than most positions. A defense's points lean heavily on takeaways and touchdowns, among the least predictable events in football, so the matchup, an opponent's turnover rate and offensive line quality, carries more weight here than for an offensive skill position. A kicker's floor is field goal volume, which rises in a game expected to stall in the red zone and falls in one expected to end in touchdowns, so the same game-environment signal that lowers a kicker's outlook often raises the defense's. Both are the most matchup-driven calls on the board and worth checking against the week's projected team totals.",
  },
};

/* ---------- The method, one sentence per step ---------- */

const METHOD_STEPS: { icon: LucideIcon; text: string }[] = [
  {
    icon: ChartLine,
    text: "Start with the projection: it already accounts for volume, role, and game script, so it beats a gut feeling about a name you recognize.",
  },
  {
    icon: Shield,
    text: "Weigh the matchup next, favorable or tough, but treat it as a nudge on a close projection rather than a reason to overturn a clear one.",
  },
  {
    icon: ArrowUpDown,
    text: "If your team is favored, lean toward the safer floor between two similar options; if you are the underdog, lean toward the higher ceiling, since a spot start is worth more when you are chasing points than when you are protecting a lead.",
  },
  {
    icon: HeartPulse,
    text: "Check injury status and weather last, after the numbers, since a limited practice designation or a wind forecast only matters once you know which players were close to begin with.",
  },
  {
    icon: Trophy,
    text: "Never bench a clearly better player over a tough matchup alone; a stud facing a hard matchup is still usually a better start than a replacement-level player facing an easy one.",
  },
];

/* ---------- Formats, for the side panel ---------- */

const FORMAT_NOTES: { label: string; note: string }[] = [
  { label: "PPR", note: "a full point for every reception" },
  { label: "Half PPR", note: "half a point per reception" },
  { label: "Standard", note: "no points for receptions" },
  { label: "TE premium", note: "extra points for each tight end reception" },
  { label: "Superflex", note: "a flex spot that can also start a quarterback" },
];

export function WrittenSections({
  projectionSourceName,
  formatSlug,
  formatDisplay,
  closestCalls,
}: WrittenSectionsProps) {
  return (
    <div className="mt-20 space-y-16 sm:space-y-20">
      <HowCalculatedSection projectionSourceName={projectionSourceName} />

      <FormatSection formatSlug={formatSlug} formatDisplay={formatDisplay} />

      <div className="space-y-5">
        <PositionJumpNav />
        {POSITION_ORDER.map((key) => (
          <PositionSection key={key} positionKey={key} closestCalls={closestCalls?.[key]} />
        ))}
      </div>

      <MethodSection />

      <FaqSection />

      <SetLineupSection />
    </div>
  );
}

/* ---------- How the verdict is calculated ---------- */

function StepCard({
  step,
  icon,
  title,
  children,
}: {
  step: number;
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="relative overflow-hidden rounded-modal border border-line bg-surface/40 p-5 sm:p-6">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-1 -top-5 select-none font-mono text-8xl font-extrabold leading-none text-ink/[0.04]"
      >
        {String(step).padStart(2, "0")}
      </span>
      <div className="relative flex items-center gap-3">
        <FeatureIconTile icon={icon} size="md" />
        <h3 className="text-base font-semibold leading-tight text-ink sm:text-lg">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-cyan">
            Step {step}
            <span className="sr-only">: </span>
          </span>
          {title}
        </h3>
      </div>
      <p className="relative mt-4 leading-relaxed text-ink-muted">{children}</p>
    </li>
  );
}

function HowCalculatedSection({ projectionSourceName }: { projectionSourceName: string }) {
  return (
    <section aria-labelledby="start-sit-calculated" className="space-y-6">
      <FeatureSectionHeader
        id="start-sit-calculated"
        icon={Calculator}
        eyebrow="The method"
        title="How the Beacon Breakdown start/sit verdict is calculated"
      />

      <ol role="list" className="grid gap-4 md:grid-cols-2">
        <StepCard step={1} icon={ChartLine} title="The projection">
          It starts with a weekly point projection from {projectionSourceName}, rescored under the format set in
          the site header rather than left in one generic scoring. That single adjustment is why a TE premium league
          or a superflex league can see a different lean than a standard league for the same two players.
        </StepCard>
        <StepCard step={2} icon={Shield} title="The matchup">
          Next comes the matchup: how many fantasy points the opposing defense has allowed to that position,
          measured from our own player-by-player results rather than taken from the projection source, and adjusted
          for the strength of the offenses that defense actually faced. It blends the two most recent seasons of
          games actually played, weighting the more recent one heavier.
        </StepCard>
        <StepCard step={3} icon={Target} title="The reliability discount">
          Then a reliability discount: how often the player has actually beaten the player&apos;s own projection in
          games graded so far this season, and how often the player has been available to play at all. A
          boom-or-bust player gets pulled back toward the field; a steady one keeps more of that projected number.
        </StepCard>
        <StepCard step={4} icon={Gauge} title="The confidence figure">
          Finally, the confidence figure: the probability that the player you are told to start actually outscores
          the closest player left on the bench, built from the same win-probability math the League Pulse schedule
          board uses to grade a matchup.
        </StepCard>
      </ol>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex items-start gap-3 rounded-card border border-line bg-base/40 p-4">
          <FeatureIconTile icon={Clock} size="sm" />
          <p className="text-sm leading-relaxed text-ink-muted">
            Projections and injury designations refresh once a day; the timestamp above the board is the exact time
            the numbers you are looking at were last pulled.
          </p>
        </div>
        <LinkTile
          href="/guides/how-ff-beacon-works"
          icon={BookOpen}
          accent="purple"
          title="Read the full methodology behind every step above"
          body="The guide also covers what the models do not know."
        />
      </div>
    </section>
  );
}

/* ---------- Format section ---------- */

function FormatSection({ formatSlug, formatDisplay }: { formatSlug: string; formatDisplay: string }) {
  return (
    <section aria-labelledby="start-sit-format" className="space-y-6">
      <FeatureSectionHeader
        id="start-sit-format"
        icon={SlidersHorizontal}
        tone="purple"
        eyebrow="Scoring formats"
        title="Who should I start in PPR, half PPR and standard leagues?"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <p className="leading-relaxed text-ink-muted">
            The format chip at the top of the board follows whatever you have set in the site header, and every
            player&apos;s projection is repriced under that scoring rather than shown once in a single format. PPR and
            half PPR change how much a high-target pass catcher is worth next to a workhorse runner; standard drops
            the reception bonus entirely and shifts the whole board toward touchdowns and yardage.
          </p>

          <p className="leading-relaxed text-ink-muted">
            TE premium and superflex are treated as real formats here, not a checkbox bolted onto a PPR number,
            because both change who the better start actually is. For a deeper look at where a player ranks under
            your own scoring, see{" "}
            <Link href={`/rankings/${formatSlug}`} className={LINK_CLASS}>
              the full {formatDisplay} rankings board
            </Link>{" "}
            or{" "}
            <Link href="/rankings" className={LINK_CLASS}>
              browse rankings for every format we support
            </Link>
            .
          </p>
        </div>

        <div className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Your board is set to</p>
          <p className="mt-1 text-xl font-bold tracking-tight text-ink">{formatDisplay}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Change it from the format control in the site header.
          </p>
          <ul role="list" aria-label="How the formats differ" className="mt-4 space-y-2.5 border-t border-line pt-4">
            {FORMAT_NOTES.map(({ label, note }) => (
              <li key={label} className="flex items-start gap-2.5 text-sm leading-snug">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-purple" />
                <span>
                  <span className="font-semibold text-ink">{label}</span>
                  <span className="text-ink-muted">: {note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ---------- Position sections ---------- */

function PositionJumpNav() {
  return (
    <nav aria-label="Start/sit advice by position" className="rounded-modal border border-line bg-surface/30 p-4 sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">Advice by position</p>
      <ul role="list" className="mt-3 flex flex-wrap gap-2">
        {POSITION_ORDER.map((key) => {
          const meta = POSITION_META[key];
          return (
            <li key={key}>
              <a
                href={`#${meta.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-accent bg-base/60 px-4 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${meta.dot}`} />
                {meta.name}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function PositionSection({
  positionKey,
  closestCalls,
}: {
  positionKey: StartSitPositionKey;
  closestCalls?: ReactNode;
}) {
  const meta = POSITION_META[positionKey];
  const copy = POSITION_COPY[positionKey];

  return (
    <section
      aria-labelledby={meta.id}
      className="scroll-mt-24 rounded-modal border border-line bg-surface/30 p-5 sm:p-7"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-card border font-mono font-extrabold tracking-wide ${
            meta.abbr.length > 3 ? "text-xs" : "text-base"
          } ${meta.tile}`}
        >
          {meta.abbr}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={meta.id} className="scroll-mt-24 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {copy.heading}
          </h2>
          <ul role="list" aria-label={meta.factorsLabel} className="mt-3 flex flex-wrap gap-2">
            {meta.factors.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-line-accent bg-base/60 px-3 py-1 text-xs font-medium text-ink-muted"
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-cyan" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={`mt-5 grid gap-6 ${closestCalls ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}`}>
        <p className="leading-relaxed text-ink-muted">{copy.body}</p>
        {closestCalls ? <div>{closestCalls}</div> : null}
      </div>
    </section>
  );
}

/* ---------- Method ---------- */

function MethodSection() {
  return (
    <section aria-labelledby="start-sit-method" className="space-y-6">
      <FeatureSectionHeader
        id="start-sit-method"
        icon={ListChecks}
        eyebrow="In order"
        title="How do I decide who to start in fantasy football?"
      />
      <ol role="list" className="space-y-3">
        {METHOD_STEPS.map(({ icon: Icon, text }, index) => (
          <li key={text} className="flex gap-4 rounded-card border border-line bg-surface/30 p-4 sm:p-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-beacon font-mono text-sm font-extrabold text-[#07070D]">
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-cyan" />
              <p className="leading-relaxed text-ink-muted">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- FAQ ---------- */

function FaqSection() {
  return (
    <section aria-labelledby="start-sit-faq" className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-24 lg:self-start">
        <FeatureSectionHeader
          id="start-sit-faq"
          layout="stacked"
          icon={CircleHelp}
          eyebrow="FAQ"
          title="Start/sit questions, answered"
        />
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">
          Comparing up to {MAX_START_SIT_PLAYERS} players at once is built into the board above; nothing here
          requires an account.
        </p>
      </div>
      <FaqAccordion items={START_SIT_FAQ} />
    </section>
  );
}

/* ---------- Set your whole lineup ---------- */

function SetLineupSection() {
  return (
    <section
      aria-labelledby="start-sit-lineup"
      className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-gradient-to-br from-brand-purple/[0.18] via-surface/70 to-brand-cyan/[0.12] p-6 sm:p-8"
      style={{ boxShadow: "0 0 100px -55px rgba(168, 85, 247, 0.8)" }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage: "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <FeatureSectionHeader
            id="start-sit-lineup"
            icon={ClipboardList}
            tone="purple"
            eyebrow="League Pulse"
            title="Set your whole lineup, not just one call"
          />
          <p className="mt-4 max-w-2xl leading-relaxed text-ink-muted">
            This tool answers one question at a time: of the players you put in, which ones to start. League Pulse
            answers a bigger one, your whole starting lineup for the week, filled from your actual Sleeper roster
            under your league&apos;s real scoring.
          </p>
        </div>
        <Link
          href="/tools/league-pulse"
          className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-card bg-beacon px-6 py-3 text-sm font-bold text-[#07070D] shadow-[0_18px_40px_-20px_rgba(168,85,247,0.9)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Set your whole lineup for the week
          <ArrowRight
            aria-hidden="true"
            className="h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    </section>
  );
}
