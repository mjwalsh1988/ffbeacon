/**
 * How It Works: a collapsible plain-language explainer for Signal Scout
 * (plan sections 4, 21). Server component, no client JS needed since native
 * <details>/<summary> gives free keyboard and screen reader disclosure
 * semantics without a click handler.
 *
 * All numbers come from the LIVE admin settings passed down from page.tsx
 * (scoring.starting_score, guest_daily_round_limit, scoring.max_wrong_guesses,
 * and the four tier costs). Never hardcode a number here; if the admin
 * changes a cost, this copy must reflect it on the next page load.
 *
 * LAYOUT: this component carries no page-level layout of its own (no max
 * width, no horizontal padding, no outer margin). It lives under the boards
 * inside leaderboard-rail.tsx, which decides where it sits and how much room
 * it gets.
 *
 * RENDERED TWICE: the rail puts it under the boards on desktop AND under the
 * boards in the slide-up modal. Both copies are in the DOM at once whenever the
 * modal is open (the rail copy is only display:none), so the heading id CANNOT
 * be hardcoded or the page would ship a duplicate id. Every caller passes its
 * own headingId.
 */

import {
  ChevronDown,
  Flame,
  Gauge,
  HelpCircle,
  Layers,
  Target,
  TrendingUp,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { TIER_DISPLAY_NAMES } from "./clue-grid";

export interface HowItWorksProps {
  startingScore: number;
  guestDailyLimit: number;
  maxWrongGuesses: number;
  tierCosts: {
    weak: number;
    clear: number;
    ping: number;
    scan: number;
  };
  /** Unique per rendered copy. See the RENDERED TWICE note above. */
  headingId: string;
}

/** The four buyable tiers, cheapest first, with what each one tends to reveal.
 *  Names come from TIER_DISPLAY_NAMES so this list and the clue chips on the
 *  board can never call the same tier two different things. */
const TIERS = [
  {
    key: "weak" as const,
    tone: "border-brand-cyan/40 text-brand-cyan",
    body: "Small nudges: an age range, a jersey number.",
  },
  {
    key: "clear" as const,
    tone: "border-brand-cyan/70 text-brand-cyan",
    body: "Sharper facts: college, or an exact age.",
  },
  {
    key: "ping" as const,
    tone: "border-brand-purple/60 text-brand-purple",
    body: "Strong signals: the exact position, or a positional finish.",
  },
  {
    key: "scan" as const,
    tone: "border-signal-warning/60 text-signal-warning",
    body: "The big reveals: current team, or a last name initial.",
  },
];

export function HowItWorks({
  startingScore,
  guestDailyLimit,
  maxWrongGuesses,
  tierCosts,
  headingId,
}: HowItWorksProps) {
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        How it works
      </h2>
      {/* Closed on arrival, in the rail and in the sheet alike. It is reference
          material: a player who wants the rules opens it, and one who does not
          should not have to scroll six sections of them to reach the boards. */}
      <details
        className="group relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
        }}
      >
        {/* Beacon hairline, matching the leaderboard panel above it. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
        {/* tabIndex={0} is load-bearing, not redundant: <summary> is already
            focusable, but the focus trap in components/slide-up-dialog.tsx
            enumerates focusables with
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            which <summary> matches none of. This explainer is the LAST thing
            in that modal, so without an explicit tabindex the trap treats the
            element before it as the final stop and wraps Tab back to the top,
            making this disclosure unreachable by keyboard inside the modal. */}
        <summary
          tabIndex={0}
          className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan [&::-webkit-details-marker]:hidden"
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
          >
            <HelpCircle className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              The rules
            </span>
            <span className="block text-sm font-semibold tracking-tight text-ink">
              How Signal Scout works
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-ink-muted motion-safe:transition-transform group-open:rotate-180"
          />
        </summary>

        <div className="space-y-2.5 px-4 pb-4">
          <Rule icon={Target} title="The objective">
            Every round hides one real NFL player behind a handful of clues. Buy hints
            to reveal more about them, then name the player before the signal burns
            out.
          </Rule>

          <Rule icon={Gauge} title="Scoring">
            Every round starts at{" "}
            <Figure>{startingScore}</Figure> points. Each hint costs points by tier,
            and a wrong guess, a Bad Read, costs points too.{" "}
            <Figure>{maxWrongGuesses}</Figure> Bad Reads end the round. Solve it with
            points still on the board and you bank whatever is left.
          </Rule>

          <Rule icon={Layers} title="Hint tiers">
            <ul role="list" className="mt-1 space-y-1.5">
              {TIERS.map((tier) => (
                <li
                  key={tier.key}
                  className="rounded-card border border-line bg-surface/40 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tier.tone}`}
                    >
                      {TIER_DISPLAY_NAMES[tier.key]}
                    </span>
                    <span className="font-mono text-xs font-bold tabular-nums text-ink">
                      {tierCosts[tier.key]}
                      <span className="ml-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                        pts
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    {tier.body}
                  </p>
                </li>
              ))}
            </ul>
          </Rule>

          <Rule icon={Flame} title="Burning out">
            Buying a hint you cannot afford burns the signal to zero, after an
            explicit confirmation. You can still guess, but the round cannot score
            and your Signal Streak resets.
          </Rule>

          <Rule icon={TrendingUp} title="Streaks">
            Signal Streak grows only when you win a round with points left. Anything
            else resets it. Daily Scout Streak counts consecutive Eastern Time days
            with at least one completed round.
          </Rule>

          <Rule icon={UserPlus} title="Guests">
            Guests get <Figure>{guestDailyLimit}</Figure> rounds per Eastern Time day.
            A free account removes the cap, saves your streaks, and puts you on the
            leaderboards.
          </Rule>
        </div>
      </details>
    </section>
  );
}

/**
 * One rule: an icon chip, a heading, and the explanation, on its own bordered
 * card so six of them read as six things rather than one wall of text.
 */
function Rule({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-base/40 p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
      </div>
      <div className="mt-1.5 text-xs leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

/** A live number from admin settings, set apart from the sentence around it. */
function Figure({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-sm font-bold tabular-nums text-brand-cyan">
      {children}
    </span>
  );
}
