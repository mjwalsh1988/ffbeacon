import {
  AlarmClock,
  Flame,
  FlaskConical,
  GraduationCap,
  RefreshCw,
  Sparkles,
  Star,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  TOOL_BADGES,
  type CardWidth,
  type HighlightColor,
  type ToolBadgeIcon,
  type ToolBadgeKey,
  type ToolBadgeTone,
} from "@/lib/site-layout/default-settings";

/**
 * The homepage tool card's tag pill and accent styles, shared by the homepage
 * and the admin form's preview so the two cannot draw a tag differently.
 *
 * Class strings are written out in full because Tailwind finds classes by
 * reading source text; a class assembled at runtime would never be generated.
 */

const BADGE_ICONS: Record<ToolBadgeIcon, LucideIcon> = {
  flame: Flame,
  sparkles: Sparkles,
  zap: Zap,
  refresh: RefreshCw,
  flask: FlaskConical,
  alarm: AlarmClock,
  trophy: Trophy,
  graduation: GraduationCap,
  star: Star,
};

/**
 * Black text on every fill. Measured: cyan 11.6:1, amber 9.8:1, green 8.3:1,
 * and 5.3:1 at the purple start of the beacon gradient. The 11px bold label is
 * not large text, so the beacon tags pass AA and not AAA; lifting them to AAA
 * would mean changing the brand gradient, which is a brand decision.
 */
const BADGE_TONE_CLASSES: Record<ToolBadgeTone, string> = {
  beacon: "bg-beacon",
  cyan: "bg-brand-cyan",
  green: "bg-signal-success",
  amber: "bg-signal-warning",
};

/** A tag pill. The label is real text, so it is read with the card it sits on. */
export function ToolBadgePill({ badge }: { badge: ToolBadgeKey }) {
  const definition = TOOL_BADGES[badge];
  const Icon = BADGE_ICONS[definition.icon];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-black ${BADGE_TONE_CLASSES[definition.tone]}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {definition.label}
    </span>
  );
}

/** Border, ring and shadow of a card, highlighted or not. */
export const CARD_ACCENT_CLASSES: Record<HighlightColor | "none", string> = {
  none: "border-line bg-surface-elevated shadow-black/20 hover:border-brand-purple/60 hover:shadow-brand-purple/10",
  purple:
    "border-brand-purple/60 bg-surface-elevated shadow-brand-purple/20 ring-1 ring-brand-purple/20 hover:border-brand-purple hover:shadow-brand-purple/30",
  cyan: "border-brand-cyan/60 bg-surface-elevated shadow-brand-cyan/20 ring-1 ring-brand-cyan/20 hover:border-brand-cyan hover:shadow-brand-cyan/30",
  green:
    "border-signal-success/60 bg-surface-elevated shadow-signal-success/20 ring-1 ring-signal-success/20 hover:border-signal-success hover:shadow-signal-success/30",
  amber:
    "border-signal-warning/60 bg-surface-elevated shadow-signal-warning/20 ring-1 ring-signal-warning/20 hover:border-signal-warning hover:shadow-signal-warning/30",
};

/** The decorative glow wash in a highlighted card's corner. */
export const CARD_GLOW: Record<HighlightColor, string> = {
  purple:
    "radial-gradient(circle, rgba(168, 85, 247, 0.20) 0%, rgba(34, 211, 238, 0.09) 50%, transparent 72%)",
  cyan: "radial-gradient(circle, rgba(34, 211, 238, 0.20) 0%, rgba(168, 85, 247, 0.09) 50%, transparent 72%)",
  green:
    "radial-gradient(circle, rgba(16, 185, 129, 0.20) 0%, rgba(34, 211, 238, 0.09) 50%, transparent 72%)",
  amber:
    "radial-gradient(circle, rgba(245, 158, 11, 0.20) 0%, rgba(168, 85, 247, 0.09) 50%, transparent 72%)",
};

/**
 * Column span on the homepage grid: one column on a phone, two from `sm`, and
 * six tracks from `md` so a half-row card is exact (a third spans 2, a half 3,
 * two thirds 4, the full row 6). Keep in step with cardSpan in
 * lib/site-layout/order.ts, which the admin preview draws with.
 */
export const CARD_WIDTH_CLASSES: Record<CardWidth, string> = {
  1: "md:col-span-2",
  1.5: "md:col-span-3",
  2: "sm:col-span-2 md:col-span-4",
  3: "sm:col-span-2 md:col-span-6",
};
