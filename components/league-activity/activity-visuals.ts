import {
  ArrowLeftRight,
  Calculator,
  ClipboardList,
  Coins,
  Crown,
  Flag,
  Gavel,
  LayoutGrid,
  ListChecks,
  PenLine,
  PlusCircle,
  Repeat,
  Shield,
  SlidersHorizontal,
  Tag,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ActivityAccent, ActivityIconName } from "@/lib/league-activity/types";

/**
 * The card's look, in one place.
 *
 * `lib/league-activity/writeup.ts` returns an accent NAME and an icon NAME
 * rather than class strings and component references, for two reasons that both
 * matter: a Lucide component cannot cross the server to client boundary as a
 * value, and a writeup module has no business knowing Tailwind. So the mapping
 * lives beside the component that draws it, and a palette change is one file
 * rather than nineteen call sites.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Every accent here sits behind an eyebrow
 * that says the same thing in words ("Trade", "Waiver claim", "Scoring
 * settings"), and every icon is aria-hidden. Someone who cannot see the purple
 * rail loses nothing.
 *
 * Contrast, measured against the panel surface #0F0F1A: cyan 10.5:1, success
 * 7.5:1, warning 9.9:1, danger 6.0:1, purple 4.9:1, ink-muted 9.0:1. All clear
 * AA for the small uppercase eyebrow text they carry, and the two lowest are
 * used for the eyebrow only, never for a whole sentence.
 */

export const ACTIVITY_ICONS: Record<ActivityIconName, LucideIcon> = {
  trade: ArrowLeftRight,
  waiver: Coins,
  freeAgent: PlusCircle,
  gavel: Gavel,
  trophy: Trophy,
  lineup: ListChecks,
  shield: Shield,
  scoring: Calculator,
  slots: LayoutGrid,
  teams: Users,
  settings: SlidersHorizontal,
  rename: PenLine,
  flag: Flag,
  draft: ClipboardList,
  userPlus: UserPlus,
  userMinus: UserMinus,
  userSwap: Repeat,
  crown: Crown,
  tag: Tag,
};

export interface AccentStyle {
  /** The vertical rail down the card's left edge. */
  rail: string;
  /** Text colour for the eyebrow. */
  text: string;
  /** The icon tile: tinted fill, matching ring, matching glyph. */
  tile: string;
  /** A very soft wash behind the card header, for the two loudest kinds. */
  glow: string;
}

export const ACTIVITY_ACCENTS: Record<ActivityAccent, AccentStyle> = {
  purple: {
    rail: "linear-gradient(180deg, #A855F7 0%, #7C3AED 100%)",
    text: "text-brand-purple",
    tile: "bg-brand-purple/12 text-brand-purple ring-1 ring-inset ring-brand-purple/35",
    glow: "rgba(168, 85, 247, 0.10)",
  },
  cyan: {
    rail: "linear-gradient(180deg, #22D3EE 0%, #06B6D4 100%)",
    text: "text-brand-cyan",
    tile: "bg-brand-cyan/12 text-brand-cyan ring-1 ring-inset ring-brand-cyan/35",
    glow: "rgba(34, 211, 238, 0.10)",
  },
  emerald: {
    rail: "linear-gradient(180deg, #10B981 0%, #059669 100%)",
    text: "text-signal-success",
    tile: "bg-signal-success/12 text-signal-success ring-1 ring-inset ring-signal-success/35",
    glow: "rgba(16, 185, 129, 0.10)",
  },
  amber: {
    rail: "linear-gradient(180deg, #F59E0B 0%, #D97706 100%)",
    text: "text-signal-warning",
    tile: "bg-signal-warning/12 text-signal-warning ring-1 ring-inset ring-signal-warning/35",
    glow: "rgba(245, 158, 11, 0.10)",
  },
  rose: {
    rail: "linear-gradient(180deg, #EF4444 0%, #B91C1C 100%)",
    text: "text-signal-danger",
    tile: "bg-signal-danger/12 text-signal-danger ring-1 ring-inset ring-signal-danger/35",
    glow: "rgba(239, 68, 68, 0.10)",
  },
  slate: {
    rail: "linear-gradient(180deg, #2A2A47 0%, #1F1F33 100%)",
    text: "text-ink-muted",
    tile: "bg-line-accent/50 text-ink-muted ring-1 ring-inset ring-line-accent",
    glow: "rgba(148, 163, 184, 0.06)",
  },
};

/**
 * Position colours for the small tag beside a player's name.
 *
 * Canonical palette: `lib/on-the-clock/position-colors.ts`. Repeated as a class
 * map here because Tailwind cannot build a class name at runtime, so
 * `text-position-${pos}` would compile to nothing.
 */
export const POSITION_TAG: Record<string, string> = {
  QB: "bg-position-qb/12 text-position-qb ring-position-qb/30",
  RB: "bg-position-rb/12 text-position-rb ring-position-rb/30",
  WR: "bg-position-wr/12 text-position-wr ring-position-wr/30",
  TE: "bg-position-te/12 text-position-te ring-position-te/30",
  K: "bg-position-k/12 text-position-k ring-position-k/30",
  DEF: "bg-position-def/12 text-position-def ring-position-def/30",
  PICK: "bg-brand-purple/12 text-brand-purple ring-brand-purple/30",
};

export function positionTagClass(position: string | null): string {
  if (!position) return "bg-line-accent/40 text-ink-muted ring-line-accent";
  return POSITION_TAG[position.toUpperCase()] ?? "bg-line-accent/40 text-ink-muted ring-line-accent";
}
