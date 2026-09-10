import { CircleDashed, Dices, Gem, PiggyBank, Split, Swords, type LucideIcon } from "lucide-react";
import type {
  TeamStatus,
  TeamStatusKey,
  TeamStatusVariant,
} from "@/lib/league-team-status";

/**
 * The Contender / Loaded / Bubble / Rebuilder tag.
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
 *   - Contender: crossed swords. This team is in the fight.
 *   - Loaded: a gem. Still in the picture, and holding more than the projection
 *     gives it credit for.
 *   - Bubble: a splitting arrow. The season could still go either way, which is
 *     exactly what a mid-table Power Pulse says.
 *   - Rebuilder: a piggy bank. Assets going in for later rather than points
 *     going out now. Dynasty and keeper leagues only.
 *   - Longshot: dice. The redraft reading of the same band, where nothing
 *     carries over and the season has to break this team's way.
 *
 * Colour follows the convention the rest of League Pulse uses for a rank, cyan
 * at the top and purple at the bottom, and is never the only signal: the icon
 * and the word both carry it, and the `aria-label` spells out the full sentence
 * explaining the call, so a screen reader gets the reasoning a sighted reader
 * has to hover for.
 */

const ICON: Record<TeamStatusVariant, Record<TeamStatusKey, LucideIcon>> = {
  dynasty: {
    competitor: Swords,
    loaded: Gem,
    middle: Split,
    rebuilder: PiggyBank,
  },
  redraft: {
    competitor: Swords,
    loaded: Gem,
    middle: Split,
    // A piggy bank is the one mark that does not carry across. Banking assets
    // is the whole idea in dynasty and an impossibility in redraft, so the
    // Longshot band gets its own.
    rebuilder: Dices,
  },
};

/** Border, fill, text, and glow per tag. Kept as one string so a tone is one
 *  thing to change rather than four. */
/**
 * MEASURE THE TEXT AGAINST ITS OWN FILL, NOT AGAINST THE PAGE. Each pill lays a
 * 15 percent wash of its own hue under its own label, which lifts the local
 * background and eats most of a contrast margin computed against bare
 * `base`. The label is 10px or 11px bold, which does NOT qualify as large text,
 * so the AA floor is the full 4.5:1.
 *
 * Ratios below are text against the composited fill, worst ground first
 * (`surface.elevated`, then `surface`, then `base`):
 *
 *   competitor  #22D3EE   7.30 to 8.76   AA and AAA
 *   loaded      #10B981   5.57 to 6.59   AA, short of AAA
 *   middle      #F4F4F8  13.23 to 15.65  AA and AAA
 *   rebuilder   #C084FC   5.29 to 6.29   AA, short of AAA
 *
 * Rebuilder was `brand-purple` (#A855F7) and measured 3.79 to 4.44, failing AA
 * on every ground. Without the fill the same colour is 5.08:1, which is how it
 * survived review the first time: the fill is exactly the step that sinks it.
 * `purple-400` keeps the band unmistakably purple and clears the floor. The
 * borders and glows stay on `brand-purple`, because a 60 percent border is
 * decoration and answers to the 3:1 non-text threshold.
 *
 * Hue is never the only signal on any of these: the icon and the word both
 * carry the band, and the aria-label spells out the whole call.
 */
const TONE: Record<TeamStatusKey, string> = {
  competitor:
    "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan shadow-[0_0_18px_-7px_rgba(34,211,238,0.9)]",
  loaded:
    "border-signal-success/60 bg-signal-success/15 text-signal-success shadow-[0_0_18px_-7px_rgba(16,185,129,0.9)]",
  middle:
    "border-ink-subtle/50 bg-ink-subtle/15 text-ink shadow-[0_0_18px_-9px_rgba(244,244,248,0.5)]",
  rebuilder:
    "border-brand-purple/60 bg-brand-purple/15 text-purple-400 shadow-[0_0_18px_-7px_rgba(168,85,247,0.9)]",
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
  /** Use the short label ("Contend") instead of the full one. The icon stays
   *  either way, which is what keeps the two forms recognizable as the same
   *  tag. */
  compact?: boolean;
  className?: string;
}) {
  const Icon = ICON[status.variant][status.key];
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
 * dashed outline and no fill so it is obviously an absence rather than a fifth
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
