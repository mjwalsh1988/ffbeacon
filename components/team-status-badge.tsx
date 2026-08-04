import { CircleDashed, PiggyBank, Split, Swords, type LucideIcon } from "lucide-react";
import type { TeamStatus, TeamStatusKey } from "@/lib/league-team-status";

/**
 * The Competitor / Mid Tier / Rebuilder tag.
 *
 * Built to read as a tag at a glance rather than as another line of text: an
 * icon, a filled pill, a bright border, and a soft glow in the tag's own colour.
 * That matters most in the league list, where the tag sits in a column of plain
 * values and has to be findable without reading it.
 *
 * The icon is the constant. It is the same mark in the league list, the
 * rankings tables, the team cards, and the mobile sheets, so the tag is
 * recognizable before the label is legible and stays recognizable in the
 * compact form where the label shortens to one word.
 *
 *   - Competitor: crossed swords. This team is in the fight.
 *   - Mid Tier: a splitting arrow. The season could still go either
 *     way, which is exactly what a mid-table Power Pulse says.
 *   - Rebuilder: a piggy bank. Assets going in for later rather than points
 *     going out now.
 *
 * Colour follows the convention the rest of League Pulse uses for a rank, cyan
 * at the top and purple at the bottom, and is never the only signal: the icon
 * and the word both carry it, and the `aria-label` spells out the full sentence
 * explaining the call, so a screen reader gets the reasoning a sighted reader
 * has to hover for.
 */

const ICON: Record<TeamStatusKey, LucideIcon> = {
  competitor: Swords,
  middle: Split,
  rebuilder: PiggyBank,
};

/** Border, fill, text, and glow per tag. Kept as one string so a tone is one
 *  thing to change rather than four. */
const TONE: Record<TeamStatusKey, string> = {
  competitor:
    "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan shadow-[0_0_18px_-7px_rgba(34,211,238,0.9)]",
  middle:
    "border-ink-subtle/50 bg-ink-subtle/15 text-ink shadow-[0_0_18px_-9px_rgba(244,244,248,0.5)]",
  rebuilder:
    "border-brand-purple/60 bg-brand-purple/15 text-brand-purple shadow-[0_0_18px_-7px_rgba(168,85,247,0.9)]",
};

const SIZE = {
  sm: { pill: "gap-1 px-2 py-0.5 text-[10px]", icon: "h-3 w-3" },
  md: { pill: "gap-1.5 px-2.5 py-1 text-[11px]", icon: "h-3.5 w-3.5" },
} as const;

export function TeamStatusBadge({
  status,
  size = "md",
  compact = false,
  className = "",
}: {
  status: TeamStatus;
  size?: keyof typeof SIZE;
  /** Use the short label ("Rebuild") instead of the full one. The icon stays
   *  either way, which is what keeps the two forms recognizable as the same
   *  tag. */
  compact?: boolean;
  className?: string;
}) {
  const Icon = ICON[status.key];
  const dims = SIZE[size];
  // An empty reason means the caller is already explaining the tag next to it,
  // as the legend does. Repeating the sentence there would make a screen reader
  // read the same explanation twice in a row.
  const reason = status.reason.trim();
  return (
    <span
      title={reason || undefined}
      aria-label={reason ? `${status.label}. ${reason}` : status.label}
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-bold tracking-tight ${TONE[status.key]} ${dims.pill} ${className}`}
    >
      <Icon aria-hidden="true" className={`${dims.icon} shrink-0`} />
      {compact ? status.short : status.label}
    </span>
  );
}

/**
 * What sits in a status slot for a league we have never calculated. Same shape
 * and same icon slot as a real tag so the column reads as one thing, with a
 * dashed outline and no fill so it is obviously an absence rather than a fourth
 * category.
 *
 * Rendered as plain text rather than a link: on the league list the whole row
 * is already a link, and it points at the Power Pulse tab in exactly this case,
 * so opening the league is what builds the missing number.
 */
export function TeamStatusPending({
  size = "md",
  className = "",
}: {
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const dims = SIZE[size];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border border-dashed border-line-accent font-semibold text-ink-subtle ${dims.pill} ${className}`}
    >
      <CircleDashed aria-hidden="true" className={`${dims.icon} shrink-0`} />
      Not yet synced
    </span>
  );
}
