import Link from "next/link";
import { PlayerHeadshot } from "@/components/player-headshot";
import {
  normalizePositionColor,
  POSITION_BADGE,
  POSITION_BADGE_FALLBACK,
} from "@/lib/on-the-clock/position-colors";
import type { BoardEntry } from "@/lib/draft-value/guide-data";

/**
 * One player on the draft-guide board.
 *
 * READS AS A PLAYER FIRST. The card leads with a headshot, the name, the
 * position in its own hue, and the team on its own brand color, so a reader
 * scanning the page can tell at a glance that each block is a person rather
 * than a paragraph with numbers in it. A team accent bar runs down the left edge
 * in that team's primary color.
 *
 * THE TWO NUMBERS THAT MATTER ARE THE BIGGEST THINGS ON IT. "Goes at" and
 * "We'd take" are the whole argument, so they are set large and tabular with the
 * swing between them stated in words underneath. Everything else is supporting
 * evidence and is sized accordingly.
 *
 * MOBILE-FIRST, AND NOTHING IS HIDDEN. There is no `hidden sm:` anywhere in this
 * file. The header wraps, the headline pair stays side by side at every width
 * because it is the point of the card, and the supporting stats wrap onto more
 * lines on a phone instead of disappearing.
 *
 * THE SENTENCE IS STILL THE CONTENT. The verdict is a full plain-English
 * paragraph and it sits directly under the headline numbers. A reader using a
 * screen reader gets the conclusion in one pass rather than assembling it from
 * six labelled figures, and the numbers corroborate rather than carry it.
 * Nothing here is conveyed by color alone: the position hue sits behind the
 * position's own letters, and the team color sits behind the team's own
 * abbreviation.
 */

function pickLabel(value: number): string {
  return String(Math.round(value));
}

/**
 * The swing, in words rather than a signed number.
 *
 * A leading "+" is the entire meaning of this figure and screen readers drop it
 * at default punctuation verbosity, so "+14" and "14" are read identically.
 */
function gapLabel(gap: number): string {
  const rounded = Math.round(gap);
  if (rounded === 0) return "Goes right about where we would take him";
  const n = Math.abs(rounded);
  const noun = n === 1 ? "pick" : "picks";
  return rounded > 0
    ? `Lasts ${n} ${noun} longer than we would wait`
    : `Goes ${n} ${noun} before we would take him`;
}

/** Points above or below a replacement starter, said in words. */
function parLabel(par: number): string {
  const n = Math.round(par);
  if (n === 0) return "level";
  return n > 0 ? `${n} over` : `${Math.abs(n)} under`;
}

/**
 * A team color light enough to see on a dark card.
 *
 * Several NFL primaries are close to black by design: Pittsburgh is #101820 and
 * Washington is #5A1414. Painted straight onto a #0F0F1A surface those read as
 * nothing at all, so the accent would silently vanish for a handful of teams.
 * This lifts the color toward white until it clears a minimum luminance, which
 * keeps the team's actual hue rather than swapping in a generic accent.
 *
 * Falls back to brand purple only when there is no team color at all.
 */
export function readableAccent(hex: string | null): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return "#A855F7";

  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);

  // Perceived brightness, 0 to 255. Below this a color disappears on our ground.
  const MIN_BRIGHTNESS = 90;
  const brightness = () => 0.299 * r + 0.587 * g + 0.114 * b;

  // Blend toward white in small steps so the hue survives the lift.
  let guard = 0;
  while (brightness() < MIN_BRIGHTNESS && guard < 40) {
    r = Math.min(255, Math.round(r + (255 - r) * 0.15));
    g = Math.min(255, Math.round(g + (255 - g) * 0.15));
    b = Math.min(255, Math.round(b + (255 - b) * 0.15));
    guard += 1;
  }

  const hx = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

/** Confidence as a word, because a bare 0.37 means nothing to a reader. */
function confidenceWord(confidence: number | null): string {
  if (confidence === null) return "Unknown";
  if (confidence >= 0.85) return "High";
  if (confidence >= 0.6) return "Solid";
  if (confidence >= 0.4) return "Moderate";
  return "Thin";
}

/** The category badge, in the brand's own language. */
const CATEGORY_STYLE: Record<string, { label: string; className: string }> = {
  steal: { label: "Steal", className: "border-brand-cyan/50 bg-brand-cyan/15 text-brand-cyan" },
  swing: { label: "Late swing", className: "border-brand-purple/50 bg-brand-purple/15 text-brand-purple" },
  fade: { label: "Fade", className: "border-amber-400/50 bg-amber-400/15 text-amber-300" },
  fair: { label: "Priced right", className: "border-white/20 bg-white/5 text-ink-muted" },
};

/** One large headline figure with the word for what it is. */
function Headline({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "market" | "beacon";
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </p>
      <p
        className="mt-0.5 text-3xl font-semibold leading-none tabular-nums sm:text-4xl"
        style={{ color: tone === "beacon" ? "#22D3EE" : "#F4F4F8" }}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * One supporting figure and the word for what it is.
 *
 * Mono, bold, and brand purple, matching the stat tiles on the player profile
 * (components/player-profile/overview-sidebar.tsx and weekly-projections.tsx),
 * so a number means the same thing visually wherever it appears on the site.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-brand-purple/30 bg-brand-purple/[0.07] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-bold leading-none tabular-nums text-brand-purple">
        {value}
      </p>
    </div>
  );
}

export function StealRow({ entry, rank }: { entry: BoardEntry; rank: number }) {
  const position = entry.position.toUpperCase();
  const positionKey = normalizePositionColor(position);
  const positionClass = positionKey ? POSITION_BADGE[positionKey] : POSITION_BADGE_FALLBACK;
  const category = CATEGORY_STYLE[entry.category] ?? CATEGORY_STYLE.fair;
  const accent = readableAccent(entry.teamColor);

  return (
    <article className="relative overflow-hidden rounded-xl border border-white/10 bg-surface/60">
      {/* The team's own color, as a spine down the left edge. Decorative: the
          team is also named in text beside it. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: accent }}
      />

      <div className="pl-5 pr-4 py-4 sm:pl-6 sm:pr-5">
        {/* ---- Who ---- */}
        <div className="flex items-start gap-3">
          <span className="shrink-0">
            <PlayerHeadshot sleeperId={entry.sleeperId} name="" size={56} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                aria-hidden="true"
                className="text-xs font-semibold tabular-nums text-ink-muted"
              >
                {rank}.
              </span>
              <h3 className="text-lg font-semibold leading-tight text-ink sm:text-xl">
                {entry.slug ? (
                  <Link
                    href={`/players/${entry.slug}`}
                    className="inline-flex min-h-11 -my-2 items-center underline decoration-white/25 underline-offset-4 hover:decoration-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    {entry.name}
                  </Link>
                ) : (
                  entry.name
                )}
              </h3>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold tracking-wide ${positionClass}`}
              >
                {position}
              </span>
              {entry.team ? (
                // The eye gets the abbreviation in the team's color; the ear
                // gets the full team name. Showing both as visible text was
                // redundant, and dropping the full name outright would have
                // left a screen reader with three unexplained letters.
                <span
                  className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold text-ink"
                  style={{ borderColor: `${accent}80`, background: `${accent}26` }}
                >
                  <span aria-hidden="true">{entry.team}</span>
                  <span className="sr-only">{entry.teamName ?? entry.team}</span>
                </span>
              ) : (
                <span className="text-xs text-ink-muted">Free agent</span>
              )}
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${category.className}`}
              >
                {category.label}
              </span>
            </div>
          </div>
        </div>

        {/* ---- The argument, as the two numbers it actually is ---- */}
        {entry.marketAdp !== null || entry.beaconPick !== null ? (
          <div className="mt-4 rounded-lg border border-white/10 bg-black/25 px-4 py-3">
            <div className="flex items-end gap-4">
              {entry.marketAdp !== null ? (
                <Headline label="Goes at" value={pickLabel(entry.marketAdp)} tone="market" />
              ) : null}
              {entry.beaconPick !== null ? (
                <Headline label="We'd take" value={pickLabel(entry.beaconPick)} tone="beacon" />
              ) : null}
            </div>
            {entry.valueGap !== null ? (
              <p className="mt-2 border-t border-white/10 pt-2 text-sm font-medium text-ink">
                {gapLabel(entry.valueGap)}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ---- Why ---- */}
        <p className="mt-3 leading-relaxed text-ink-muted">{entry.verdict}</p>

        {/* ---- Supporting evidence. Wraps on a phone, never hidden. ---- */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {entry.pointsAboveReplacement !== null ? (
            // Spelled out rather than signed: a screen reader drops a leading
            // plus at default verbosity, and "over" versus "under" is the whole
            // point of the figure.
            <Stat
              label={`Pts vs replacement ${position}`}
              value={parLabel(entry.pointsAboveReplacement)}
            />
          ) : null}
          {entry.beatRate !== null ? (
            <Stat label="Beats projection" value={`${Math.round(entry.beatRate * 100)}%`} />
          ) : null}
          <Stat label="Confidence" value={confidenceWord(entry.confidence)} />
        </div>
      </div>
    </article>
  );
}
