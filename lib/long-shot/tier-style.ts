/**
 * The one tier color record (plan 18A.3). Every component reads tier color
 * and icon from here, so a tier never has two colors. Each color is always
 * shown beside its word. Gold, silver and bronze are the podium's metal tones
 * (owner decision 13) and appear nowhere else.
 */

import { Flame, Goal, LocateFixed, RadioTower, Target, type LucideIcon } from "lucide-react";
import { TIER_WORDS, type Tier } from "./types";

export interface TierStyle {
  word: string;
  /** The tier color. Long Shot's fill is the beacon gradient; this is its cyan end. */
  hex: string;
  /** Text color class for the tier word and figures. */
  text: string;
  /** Border class for chips and tiles. */
  border: string;
  /** 15 percent tint background class for chips. */
  tint: string;
  /** Text color drawn on a filled marker of this tier. */
  onMarker: string;
}

export const TIER_STYLE: Record<Tier, TierStyle> = {
  chalk: {
    word: TIER_WORDS.chalk,
    hex: "#8A8A9C",
    text: "text-ink-subtle",
    border: "border-[#8A8A9C]",
    tint: "bg-[#8A8A9C]/15",
    onMarker: "#F4F4F8",
  },
  field: {
    word: TIER_WORDS.field,
    hex: "#C084FC",
    text: "text-brand-purple-light",
    border: "border-[#C084FC]",
    tint: "bg-[#C084FC]/15",
    onMarker: "#07070D",
  },
  deep: {
    word: TIER_WORDS.deep,
    hex: "#A855F7",
    text: "text-brand-purple",
    border: "border-[#A855F7]",
    tint: "bg-[#A855F7]/15",
    onMarker: "#07070D",
  },
  sleeper: {
    word: TIER_WORDS.sleeper,
    hex: "#22D3EE",
    text: "text-brand-cyan",
    border: "border-[#22D3EE]",
    tint: "bg-[#22D3EE]/15",
    onMarker: "#07070D",
  },
  long_shot: {
    word: TIER_WORDS.long_shot,
    hex: "#22D3EE",
    text: "bg-beacon bg-clip-text text-transparent",
    border: "border-[#22D3EE]",
    tint: "bg-[#22D3EE]/15",
    onMarker: "#07070D",
  },
};

export const MISS_STYLE = {
  word: "Miss",
  hex: "#EF4444",
  text: "text-signal-danger",
  border: "border-[#EF4444]",
} as const;

export const LONG_SHOT_GLOW = "0 0 32px -8px rgba(34,211,238,0.9)";

const ICONS: Record<Tier, LucideIcon> = {
  chalk: Target,
  field: Goal,
  deep: LocateFixed,
  sleeper: RadioTower,
  long_shot: Flame,
};

/** The tier's icon; a miss has none. */
export function tierIcon(tier: Tier | null): LucideIcon | null {
  return tier ? ICONS[tier] : null;
}

export const METAL = {
  gold: { hex: "#F5C451", ring: 4, glow: "0 0 48px -12px rgba(245,196,81,0.55)" },
  silver: { hex: "#C9CDD6", ring: 3, glow: null },
  bronze: { hex: "#D08A5B", ring: 3, glow: null },
} as const;
