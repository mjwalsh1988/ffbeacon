/**
 * The opening of one long-form section on a tool page: a large icon tile, a
 * short eyebrow and the section's heading, with an optional intro sentence.
 *
 * Written for the prose under Who Should I Start and the trade calculator.
 * Those sections are the part of each page a crawler reads, and they had
 * been plain headings over plain paragraphs, with nothing to tell one
 * section from the next at a glance. The tile gives every section a visible
 * start.
 *
 * The icon tile is aria-hidden. The eyebrow is NOT: it is visible text, and a
 * screen reader following the pointer finds nothing at all on an aria-hidden
 * word. Heading navigation reads only the h2, which is what the section's
 * aria-labelledby points at, so exposing the eyebrow costs one short line in
 * linear reading and nothing else.
 *
 * Eyebrow text uses a lighter step of its tone (EYEBROW below). Brand purple
 * at 11px measures about 4.3:1 on a purple-tinted panel, under AA; purple-400
 * clears it comfortably.
 *
 * Presentational server component.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

const TONES = {
  cyan: "#22D3EE",
  purple: "#A855F7",
  success: "#10B981",
} as const;

export type FeatureTone = keyof typeof TONES;

/** Text colour for the eyebrow: the tone itself, one step lighter where the tone is too dark for 11px text. */
const EYEBROW: Record<FeatureTone, string> = {
  cyan: "#22D3EE",
  purple: "#C084FC",
  success: "#34D399",
};

/**
 * The icon in a tinted, bordered square. Exported on its own for the step
 * and callout cards that sit under a section header and want the same tile
 * at a smaller size.
 */
export function FeatureIconTile({
  icon: Icon,
  tone = "cyan",
  size = "lg",
}: {
  icon: LucideIcon;
  tone?: FeatureTone;
  size?: "lg" | "md" | "sm";
}) {
  const color = TONES[tone];
  const box =
    size === "lg" ? "h-12 w-12 sm:h-14 sm:w-14" : size === "md" ? "h-11 w-11" : "h-9 w-9";
  const glyph = size === "lg" ? "h-6 w-6 sm:h-7 sm:w-7" : size === "md" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none flex shrink-0 items-center justify-center rounded-card border ${box}`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${color}33 0%, ${color}0D 100%)`,
        borderColor: `${color}66`,
        color,
        boxShadow: `0 14px 36px -20px ${color}`,
      }}
    >
      <Icon className={glyph} strokeWidth={1.75} />
    </span>
  );
}

export function FeatureSectionHeader({
  id,
  icon,
  eyebrow,
  title,
  intro,
  tone = "cyan",
  layout = "inline",
}: {
  /** The h2's id, which the section's aria-labelledby points at. */
  id: string;
  icon: LucideIcon;
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  tone?: FeatureTone;
  /** "inline" puts the tile beside the heading; "stacked" puts it above, for a narrow column. */
  layout?: "inline" | "stacked";
}) {
  const eyebrowColor = EYEBROW[tone];
  return (
    <div className={layout === "inline" ? "flex items-start gap-4 sm:gap-5" : ""}>
      <FeatureIconTile icon={icon} tone={tone} />
      <div className={layout === "inline" ? "min-w-0 flex-1" : "mt-4"}>
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: eyebrowColor }}>
            {eyebrow}
          </p>
        )}
        <h2
          id={id}
          className={`scroll-mt-24 text-2xl font-semibold tracking-tight text-ink sm:text-3xl ${
            eyebrow ? "mt-1" : ""
          }`}
        >
          {title}
        </h2>
        {intro && <p className="mt-2 max-w-3xl leading-relaxed text-ink-muted">{intro}</p>}
      </div>
    </div>
  );
}
