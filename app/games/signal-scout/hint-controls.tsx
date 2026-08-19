/**
 * Buy-a-hint controls: one button per paid signal tier (plan sections 7, 13,
 * 21). Presentational only. The API call and the burn-confirmation dialog
 * both live in signal-scout-client.tsx; this component only reports which
 * tier was clicked via onBuy.
 *
 * ABSORBED THE LOCKED SIGNALS SECTION: there used to be a second, display-only
 * "Locked signals" list above this one, four more rows restating the tier
 * name, the cost, the buys left, and the disabled reason that these buttons
 * already show. The one thing it had that these buttons did not was the
 * locked-clue count, so that folded in here as "x signals left" and the
 * section is gone. See signalsLeft below for why that is a min() rather than
 * either raw count.
 */

import { Flame, Zap } from "lucide-react";
import type { SignalTierKey } from "@/lib/signal-scout/scoring";
import { TIER_DISPLAY_NAMES } from "./clue-grid";
import { ScoutSectionHead } from "./scout-section-head";

const TIER_ORDER: SignalTierKey[] = ["weak", "clear", "ping", "scan"];

export interface HintControlsProps {
  score: number;
  burned: boolean;
  lockedCounts: Record<SignalTierKey, number>;
  purchasesRemaining: Record<SignalTierKey, number>;
  tierCosts: Record<SignalTierKey, number>;
  pendingTier: SignalTierKey | null;
  onBuy: (tier: SignalTierKey) => void;
}

/**
 * A tier button reads as a button rather than a bordered paragraph: the tier
 * name is set in the same heavy uppercase the site uses for headings, the cost
 * and the signals left sit under it as supporting text, and it is tall enough
 * (5rem) to be an obvious target.
 *
 * It is FILLED rather than outlined. The beacon gradient runs across the face,
 * lit from the top-left, with a soft inner highlight and a drop shadow so it
 * sits above the panel instead of being a hole cut in it. The label is black on
 * that fill, the same call the site's primary buttons make (bg-beacon, black
 * text), which is also what keeps the contrast comfortable on the cyan end.
 *
 * The rim runs the SAME gradient BACKWARDS, cyan where the face is purple and
 * purple where the face is cyan. Two gradients agreeing would have read as one
 * flat shape; two disagreeing give the edge somewhere to be, which is what makes
 * the button look raised. It is drawn as a two-layer background rather than a
 * border-color, because a border cannot take a gradient on its own: the face is
 * clipped to the padding box, the rim to the border box, and the transparent
 * 2px border is the gap between them.
 *
 * The burn-warning state keeps its own amber fill: it is a warning first, and
 * the gradient would have made the most dangerous button on the screen look
 * like every other one.
 */
const TIER_BUTTON_BASE =
  "relative flex min-h-[5rem] w-full flex-col justify-between gap-2 overflow-hidden rounded-card border-2 px-3 py-3 text-left shadow-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-transform enabled:motion-safe:hover:-translate-y-0.5";

function tierButtonClasses(warning: boolean) {
  return warning
    ? `${TIER_BUTTON_BASE} border-signal-warning/70 bg-signal-warning/15 text-signal-warning shadow-signal-warning/10 hover:border-signal-warning hover:bg-signal-warning/25`
    : `${TIER_BUTTON_BASE} border-transparent text-black shadow-brand-purple/30 enabled:hover:brightness-110`;
}

/** The filled face plus the reversed rim. Omitted on the warning state, which
 *  paints its own flat amber. */
function tierButtonStyle(warning: boolean): React.CSSProperties | undefined {
  if (warning) return undefined;
  return {
    backgroundImage: [
      // Face, clipped to the padding box.
      "linear-gradient(135deg, #A855F7 0%, #8B5CF6 38%, #22D3EE 100%)",
      // Rim, clipped to the border box, running the other way.
      "linear-gradient(135deg, #22D3EE 0%, #67E8F9 32%, #C084FC 72%, #A855F7 100%)",
    ].join(", "),
    backgroundOrigin: "border-box",
    backgroundClip: "padding-box, border-box",
  };
}

export function HintControls({
  score,
  burned,
  lockedCounts,
  purchasesRemaining,
  tierCosts,
  pendingTier,
  onBuy,
}: HintControlsProps) {
  return (
    <section
      aria-labelledby="hint-controls-heading"
      className="relative mt-6 overflow-hidden rounded-modal border border-brand-purple/40 p-4 shadow-[0_0_70px_-38px_rgba(168,85,247,0.95)] sm:p-5"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.16) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
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
      <ScoutSectionHead
        icon={Zap}
        eyebrow="Spend score"
        title="Buy a hint"
        id="hint-controls-heading"
        tone="purple"
      />
      <ul role="list" className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-4">
        {TIER_ORDER.map((tier) => {
          const tierName = TIER_DISPLAY_NAMES[tier];
          const cost = tierCosts[tier];
          const locked = lockedCounts[tier];
          const remaining = purchasesRemaining[tier];
          const exhausted = locked === 0;
          const limitReached = remaining === 0;
          const isPending = pendingTier === tier;
          // A purchase in flight for a DIFFERENT tier disables this button too,
          // so a screen reader user can't fire a second concurrent purchase
          // while the first is still resolving (the click would otherwise
          // silently no-op, which reads as broken rather than busy).
          const otherPending = pendingTier !== null && !isPending;

          // Two independent limits gate a tier: how many of its clues are
          // still hidden (lockedCounts) and how many buys the round's frozen
          // tier cap still allows (purchasesRemaining). Neither alone tells
          // the player what they want to know, so what actually gets shown is
          // how many more hints this tier can still yield, which is whichever
          // limit runs out first. It hits 0 exactly when the tier is either
          // exhausted or capped out, and the status line below names which.
          const signalsLeft = Math.min(locked, remaining);
          const signalsLeftText = `${signalsLeft} signal${signalsLeft === 1 ? "" : "s"} left`;

          const disabledReason = burned
            ? "Hints locked"
            : exhausted
              ? "Tier exhausted"
              : limitReached
                ? "Limit reached"
                : null;
          const disabled = Boolean(disabledReason) || isPending || otherPending;
          const isBurnWarning =
            !disabledReason && !isPending && !otherPending && score > 0 && cost >= score;

          const statusLine = isPending
            ? "Revealing..."
            : isBurnWarning
              ? "Burns out signal"
              : disabledReason;

          // Spelled out on every button rather than only the burn-warning one,
          // so the announcement never depends on how a screen reader chooses
          // to pronounce "pts", and so the count that used to live in the
          // Locked signals list is still spoken now that the list is gone.
          // Leads with the tier name, which is the button's visible label, to
          // keep label-in-name intact.
          const ariaLabel = [
            tierName,
            `${cost} points per reveal`,
            signalsLeftText,
            isBurnWarning
              ? "Warning: this costs your whole remaining signal. Buying it burns your score to zero."
              : null,
            isPending ? "Revealing" : disabledReason,
          ]
            .filter(Boolean)
            .join(", ");

          return (
            <li key={tier}>
              <button
                type="button"
                onClick={() => onBuy(tier)}
                disabled={disabled}
                aria-disabled={disabledReason ? true : undefined}
                aria-busy={isPending}
                aria-label={ariaLabel}
                className={tierButtonClasses(isBurnWarning)}
                style={tierButtonStyle(isBurnWarning)}
              >
                {/* Inner highlight along the top edge, so the face reads as
                    raised rather than flat. Decorative. */}
                {!isBurnWarning && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
                    style={{
                      backgroundImage:
                        "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, transparent 100%)",
                    }}
                  />
                )}
                <span className="relative flex w-full items-start justify-between gap-2">
                  {/* The tier name is the button's label, set the way the site
                      sets a heading: heavy, uppercase, tracked out. */}
                  <span className="text-sm font-extrabold uppercase leading-tight tracking-[0.08em] sm:text-base">
                    {tierName}
                  </span>
                  {isBurnWarning && <Flame aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
                </span>
                {/* Cost and what is left, as supporting text under the label.
                    Wraps rather than squeezing: at the four-across layout these
                    two barely share a line. */}
                <span className="relative flex w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span className="font-mono text-sm font-bold tabular-nums">
                    {cost}
                    <span
                      className={`ml-1 font-sans text-[10px] font-semibold uppercase tracking-wide ${
                        isBurnWarning ? "text-ink-subtle" : "text-black/70"
                      }`}
                    >
                      pts
                    </span>
                  </span>
                  <span
                    className={`text-[11px] ${
                      isBurnWarning ? "text-ink-subtle" : "text-black/70"
                    }`}
                  >
                    {signalsLeftText}
                  </span>
                </span>
                {statusLine && (
                  <span className="relative text-[11px] font-semibold uppercase tracking-wide">
                    {statusLine}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-subtle">
        Every hint costs score. Overreach and the signal burns out.
      </p>
    </section>
  );
}
