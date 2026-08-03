/**
 * League leaders: one bright card per superlative.
 *
 * Modeled on the On The Clock draft awards, where each award gets its own icon
 * and accent so the grid reads as distinct callouts rather than a repeating
 * template. The point of this section is to surface the things a ranking table
 * cannot: who manages their lineup best, whose starters are most trustworthy,
 * who drew the gauntlet.
 */

import {
  Trophy,
  Target,
  Trash2,
  ShieldCheck,
  Flame,
  Swords,
  Layers,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { PulseLeader } from "@/lib/league-power-pulse-data";

const THEME: Record<
  string,
  { icon: LucideIcon; text: string; border: string; bg: string; glow: string }
> = {
  "title-favorite": {
    icon: Trophy,
    text: "text-amber-300",
    border: "border-amber-400/50",
    bg: "bg-amber-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,191,36,0.9)]",
  },
  "lineup-efficiency": {
    icon: Target,
    text: "text-brand-cyan",
    border: "border-brand-cyan/50",
    bg: "bg-brand-cyan/10",
    glow: "shadow-[0_0_60px_-40px_rgba(34,211,238,0.9)]",
  },
  "lineup-waste": {
    icon: Trash2,
    text: "text-rose-300",
    border: "border-rose-400/50",
    bg: "bg-rose-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,113,133,0.9)]",
  },
  reliability: {
    icon: ShieldCheck,
    text: "text-emerald-300",
    border: "border-emerald-400/50",
    bg: "bg-emerald-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(52,211,153,0.9)]",
  },
  underachiever: {
    icon: Flame,
    text: "text-orange-300",
    border: "border-orange-400/50",
    bg: "bg-orange-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,146,60,0.9)]",
  },
  schedule: {
    icon: Swords,
    text: "text-brand-purple",
    border: "border-brand-purple/50",
    bg: "bg-brand-purple/10",
    glow: "shadow-[0_0_60px_-40px_rgba(168,85,247,0.9)]",
  },
  depth: {
    icon: Layers,
    text: "text-sky-300",
    border: "border-sky-400/50",
    bg: "bg-sky-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(125,211,252,0.9)]",
  },
  overachiever: {
    icon: TrendingUp,
    text: "text-lime-300",
    border: "border-lime-400/50",
    bg: "bg-lime-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(163,230,53,0.9)]",
  },
};

const FALLBACK = {
  icon: Trophy,
  text: "text-ink",
  border: "border-line-accent",
  bg: "bg-surface",
  glow: "",
};

export function PulseLeaders({ leaders }: { leaders: PulseLeader[] }) {
  if (leaders.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        League leaders appear once Power Pulse has scored every team.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {leaders.map((leader) => {
        const theme = THEME[leader.id] ?? FALLBACK;
        const Icon = theme.icon;
        return (
          <li
            key={leader.id}
            className={`rounded-card border p-4 ${theme.border} ${theme.bg} ${theme.glow}`}
          >
            <div className="flex items-center gap-2">
              <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${theme.text}`} />
              <h3
                className={`text-[11px] font-bold uppercase tracking-[0.14em] ${theme.text}`}
              >
                {leader.title}
              </h3>
            </div>

            <div className="mt-3 flex items-center gap-2.5">
              <SleeperAvatar
                avatarId={leader.team.ownerAvatarId}
                initial={leader.team.teamName.charAt(0)}
                title={leader.team.teamName}
                size={32}
              />
              {/* Handle under the name, matching every other place a team is
                  identified on this tab. The award means nothing if the reader
                  cannot tell whose team won it. */}
              <p className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {leader.team.teamName}
                </span>
                {leader.team.ownerHandle && (
                  <span className="block truncate text-[11px] text-ink-subtle">
                    @{leader.team.ownerHandle}
                  </span>
                )}
              </p>
              <p className={`shrink-0 font-mono text-base font-extrabold tabular-nums ${theme.text}`}>
                {leader.value}
              </p>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">{leader.blurb}</p>
          </li>
        );
      })}
    </ul>
  );
}
