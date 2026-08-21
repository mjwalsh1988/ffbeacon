/**
 * Win probability, drawn so the split is readable at a glance.
 *
 * WHAT WAS WRONG WITH THE FIRST ONE
 *   A 6px track split cyan and purple, with the two percentages in a sentence
 *   underneath. It was correct and it was unreadable: at that height, against a
 *   dark background, two saturated brand colours of similar lightness sit at
 *   nearly the same visual weight, so an 80/20 split and a 60/40 split look
 *   about the same. The reader was doing arithmetic off the caption because the
 *   drawing was not telling them anything.
 *
 * WHAT THIS DOES INSTEAD, in order of how much each part helps:
 *
 *   The numbers are the headline. Two large percentages, one at each end, each
 *   tinted to match its side of the bar and each sitting above its own team
 *   name. That alone answers "is this 80 or 55" without measuring anything.
 *
 *   The favourite is marked in words. The leading side carries a "Favoured"
 *   pill, so the answer survives greyscale, colour blindness, and a glance.
 *
 *   The track is 12px rather than 6, with the two fills separated by a hard
 *   edge and each carrying its own inline label once it is wide enough to hold
 *   one. A short bar drops its label rather than clipping it.
 *
 *   A dashed centre line marks 50. A split is much easier to read against a
 *   fixed reference than in isolation, and it is the difference between "the
 *   cyan bit is bigger" and "the cyan bit is well past even".
 *
 * ACCESSIBILITY. The whole drawing is aria-hidden and a single sentence carries
 * the same facts for a screen reader, spelled as "62 percent" rather than "62%".
 * Colour never carries meaning on its own here: every side has its percentage,
 * its team name, and the favourite has a word.
 *
 * Presentational. No state, no fetching, safe in a server component.
 */

import { pctLabel, pctWords } from "./format";

/** Below this share, a fill is too narrow to hold its own label legibly. */
const INLINE_LABEL_MIN = 0.18;

/** Neither side is called the favourite inside this band. */
const EVEN_BAND = 0.02;

export function WinProbBar({
  homeName,
  awayName,
  homeProb,
  size = "full",
}: {
  homeName: string;
  awayName: string;
  /** Probability the home side wins, 0 to 1. */
  homeProb: number;
  /**
   * "full" for the matchup page, where there is room for the tall treatment.
   * "compact" for a list of cards, which keeps every signal and less padding.
   */
  size?: "full" | "compact";
}) {
  const awayProb = 1 - homeProb;
  const homePct = Math.round(homeProb * 100);
  // Derived from the same rounding, so the two always total 100 on screen.
  const awayPct = 100 - homePct;

  const even = Math.abs(homeProb - 0.5) < EVEN_BAND;
  const homeFavoured = !even && homeProb > 0.5;
  const awayFavoured = !even && awayProb > 0.5;

  const numberSize = size === "full" ? "text-3xl sm:text-4xl" : "text-2xl";
  const trackHeight = size === "full" ? "h-3.5" : "h-3";

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <EndLabel
          name={homeName}
          pct={homePct}
          favoured={homeFavoured}
          tone="home"
          numberSize={numberSize}
          align="start"
        />
        <EndLabel
          name={awayName}
          pct={awayPct}
          favoured={awayFavoured}
          tone="away"
          numberSize={numberSize}
          align="end"
        />
      </div>

      <div aria-hidden="true" className="relative mt-2">
        <span
          className={`flex ${trackHeight} w-full overflow-hidden rounded-full border border-line bg-base`}
        >
          <span
            className="flex h-full items-center justify-start bg-brand-cyan pl-1.5"
            style={{ width: `${Math.max(2, homePct)}%` }}
          >
            {homeProb >= INLINE_LABEL_MIN && (
              <span className="text-[9px] font-bold leading-none text-base">
                {pctLabel(homeProb)}
              </span>
            )}
          </span>
          {/* The remainder rather than a second width, so the two fills always
              total the track even when the first is clamped to stay visible. */}
          <span className="flex h-full flex-1 items-center justify-end bg-brand-purple pr-1.5">
            {awayProb >= INLINE_LABEL_MIN && (
              <span className="text-[9px] font-bold leading-none text-white">
                {pctLabel(awayProb)}
              </span>
            )}
          </span>
        </span>

        {/* Even, marked. A split reads far more precisely against a fixed
            reference than on its own. */}
        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-ink/50" />
      </div>

      <p className="mt-1.5 text-[11px] text-ink-subtle">
        <span aria-hidden="true">Dashed line marks an even matchup.</span>
        <span className="sr-only">
          Win probability: {homeName} {pctWords(homeProb)}, {awayName} {pctWords(awayProb)}.
          {even
            ? " The two teams are close to even."
            : homeFavoured
              ? ` ${homeName} is favoured.`
              : ` ${awayName} is favoured.`}
        </span>
      </p>
    </div>
  );
}

/**
 * One end of the bar: the percentage, the team, and whether it is winning.
 *
 * The number is the largest thing in the component on purpose. It is what the
 * reader came for, and it is the part that does not need decoding.
 */
function EndLabel({
  name,
  pct,
  favoured,
  tone,
  numberSize,
  align,
}: {
  name: string;
  pct: number;
  favoured: boolean;
  tone: "home" | "away";
  numberSize: string;
  align: "start" | "end";
}) {
  const color = tone === "home" ? "text-brand-cyan" : "text-brand-purple";
  const chip =
    tone === "home"
      ? "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan"
      : "border-brand-purple/60 bg-brand-purple/15 text-brand-purple";

  return (
    <div
      aria-hidden="true"
      className={`min-w-0 flex-1 ${align === "end" ? "text-right" : "text-left"}`}
    >
      <div
        className={`flex items-center gap-2 ${
          align === "end" ? "justify-end" : "justify-start"
        }`}
      >
        <span className={`font-mono font-bold tabular-nums ${numberSize} ${color}`}>
          {pct}
          <span className="text-base">%</span>
        </span>
        {favoured && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chip}`}
          >
            Favoured
          </span>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs font-medium text-ink-muted">{name}</p>
    </div>
  );
}
