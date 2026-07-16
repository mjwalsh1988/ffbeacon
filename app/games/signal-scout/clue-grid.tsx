/**
 * Revealed clue grid: every clue the round has unlocked so far, starter
 * clues first (revealOrder null), then purchased clues in reveal order
 * (plan section 21). Each cell is a plain label + mono value pairing with a
 * tier chip that never relies on color alone (the tier's display name is
 * always printed alongside its tone).
 */

import type { RevealedClueOut } from "@/lib/signal-scout/round-engine";

export type ClueTierChipKey = "starter" | "weak" | "clear" | "ping" | "scan";

/** Exported so SS-T026's hint controls can reuse the same tier labels. */
export const TIER_DISPLAY_NAMES: Record<ClueTierChipKey, string> = {
  starter: "Starter",
  weak: "Weak Signal",
  clear: "Clear Signal",
  ping: "Beacon Ping",
  scan: "Full Scan",
};

const TIER_CHIP_TONES: Record<ClueTierChipKey, string> = {
  starter: "border-line text-ink-muted",
  weak: "border-brand-cyan/40 text-brand-cyan",
  clear: "border-brand-cyan/70 text-brand-cyan",
  ping: "border-brand-purple/60 text-brand-purple",
  scan: "border-signal-warning/60 text-signal-warning",
};

function isClueTierChipKey(tier: string): tier is ClueTierChipKey {
  return tier === "starter" || tier === "weak" || tier === "clear" || tier === "ping" || tier === "scan";
}

export interface ClueGridProps {
  clues: RevealedClueOut[];
  newestClueKey?: string | null;
  /** Section heading text. Defaults to "Revealed clues" (active-round usage). */
  heading?: string;
  /** id applied to the heading and referenced by aria-labelledby. Defaults to "clue-grid-heading". */
  headingId?: string;
  /**
   * Clue keys to render with a muted "never revealed" treatment (result-card's
   * full clue sheet, where `clues` is the full sheet but some entries were
   * never purchased before the round ended). Absent for active-round usage.
   */
  unseenKeys?: string[];
  /**
   * Draw the section as its own gradient-backed panel instead of a bare
   * heading + grid. On for the active round, where these clues are the thing
   * the player is actually reading and every sibling section (Buy a hint, Bad
   * Reads) is bare, so the border and beacon gradient are what lift it out of
   * the stack. Off for result-card's full clue sheet, which already sits
   * inside its own toned result panel and would only end up with a box in a
   * box.
   */
  highlight?: boolean;
}

export function ClueGrid({
  clues,
  newestClueKey,
  heading = "Revealed clues",
  headingId = "clue-grid-heading",
  unseenKeys,
  highlight = false,
}: ClueGridProps) {
  const sorted = [...clues].sort((a, b) => (a.revealOrder ?? -1) - (b.revealOrder ?? -1));
  const unseenSet = new Set(unseenKeys ?? []);

  return (
    <section
      aria-labelledby={headingId}
      className={
        highlight
          ? "relative mt-6 overflow-hidden rounded-modal border border-brand-cyan/30 p-4 shadow-[0_0_70px_-40px_rgba(34,211,238,0.9)] sm:p-5"
          : "mt-6"
      }
      style={
        highlight
          ? {
              // The beacon gradient's own 135deg purple-to-cyan direction, run
              // at low alpha so it tints the panel without touching the
              // contrast of the clue values sitting on top of it.
              backgroundImage:
                "linear-gradient(135deg, rgba(168, 85, 247, 0.18) 0%, rgba(34, 211, 238, 0.12) 55%, rgba(34, 211, 238, 0.04) 100%)",
            }
          : undefined
      }
    >
      {highlight && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
      )}
      <h4 id={headingId} className="text-sm font-semibold text-ink">
        {heading}
      </h4>
      {sorted.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No clues revealed yet.</p>
      ) : (
        <ul role="list" className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {sorted.map((clue) => {
            const tierKey = isClueTierChipKey(clue.tier) ? clue.tier : "starter";
            const isNewest = clue.clueKey === newestClueKey;
            const isUnseen = unseenSet.has(clue.clueKey);
            return (
              <li
                key={clue.clueKey}
                id={`clue-cell-${clue.clueKey}`}
                tabIndex={isNewest ? -1 : undefined}
                data-newest={isNewest ? "true" : undefined}
                className={`rounded-card border px-3 py-2.5 ${
                  isUnseen ? "border-dashed border-line bg-base/30" : "border-line bg-base/50"
                } ${
                  // Static highlight, not motion: keep it visible for
                  // reduced-motion users too (they still deserve the "this
                  // cell is new" indicator; the glow does not animate).
                  isNewest
                    ? "ring-1 ring-brand-cyan/60 shadow-[0_0_24px_-8px_rgba(34,211,238,0.7)]"
                    : ""
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TIER_CHIP_TONES[tierKey]}`}
                  >
                    {TIER_DISPLAY_NAMES[tierKey]}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    {clue.label}
                  </span>
                </div>
                <p className="mt-1.5 font-mono text-sm text-ink">{clue.displayValue}</p>
                {isUnseen && (
                  <span className="mt-1.5 inline-block rounded-full border border-line px-2 py-0.5 text-[10px] uppercase text-ink-subtle">
                    Never revealed
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
