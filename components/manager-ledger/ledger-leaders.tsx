/**
 * League leaders: one bright card per superlative.
 *
 * The same shape as `components/power-pulse/pulse-leaders.tsx`, deliberately,
 * so a reader moving between Power Pulse and Decisions meets one visual
 * language rather than two. Each award gets its own icon and accent, so the
 * grid reads as distinct callouts rather than a repeating template.
 *
 * COLOUR IS NEVER THE MEANING. Every accent is paired with an icon AND a title
 * in words, and the figure itself is printed. A reader who sees no colour at
 * all loses nothing: "Games given away, 5" says the whole thing.
 */

import {
  Target,
  Trash2,
  Flame,
  Sparkles,
  Handshake,
  ClipboardCheck,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { LedgerLeader, LedgerLeaderId } from "@/lib/manager-ledger/leaders";

const THEME: Record<
  LedgerLeaderId,
  { icon: LucideIcon; text: string; border: string; bg: string; glow: string }
> = {
  sharpest: {
    icon: Target,
    text: "text-brand-cyan",
    border: "border-brand-cyan/50",
    bg: "bg-brand-cyan/10",
    glow: "shadow-[0_0_60px_-40px_rgba(34,211,238,0.9)]",
  },
  "most-left": {
    icon: Trash2,
    text: "text-rose-300",
    border: "border-rose-400/50",
    bg: "bg-rose-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,113,133,0.9)]",
  },
  "games-given-away": {
    icon: Flame,
    text: "text-orange-300",
    border: "border-orange-400/50",
    bg: "bg-orange-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,146,60,0.9)]",
  },
  "best-waivers": {
    icon: Sparkles,
    text: "text-emerald-300",
    border: "border-emerald-400/50",
    bg: "bg-emerald-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(52,211,153,0.9)]",
  },
  "best-trade": {
    icon: Handshake,
    text: "text-brand-purple",
    border: "border-brand-purple/50",
    bg: "bg-brand-purple/10",
    glow: "shadow-[0_0_60px_-40px_rgba(168,85,247,0.9)]",
  },
  "best-draft": {
    icon: ClipboardCheck,
    text: "text-amber-300",
    border: "border-amber-400/50",
    bg: "bg-amber-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,191,36,0.9)]",
  },
  overachiever: {
    icon: TrendingUp,
    text: "text-emerald-300",
    border: "border-emerald-400/50",
    bg: "bg-emerald-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(52,211,153,0.9)]",
  },
  carried: {
    icon: TrendingDown,
    text: "text-sky-300",
    border: "border-sky-400/50",
    bg: "bg-sky-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(125,211,252,0.9)]",
  },
};

export function LedgerLeaders({ leaders }: { leaders: LedgerLeader[] }) {
  if (leaders.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        Nothing has happened in this league yet that is worth calling out. These fill in as
        managers set lineups, make claims and trade.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {leaders.map((leader) => {
        const theme = THEME[leader.id];
        const Icon = theme.icon;
        return (
          <li
            key={leader.id}
            className={`rounded-card border p-4 ${theme.border} ${theme.bg} ${theme.glow}`}
          >
            <div className="flex items-center gap-2">
              <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${theme.text}`} />
              <h3 className={`text-[11px] font-bold uppercase tracking-[0.14em] ${theme.text}`}>
                {leader.title}
              </h3>
            </div>

            <div className="mt-3 flex items-center gap-2.5">
              {/* Decorative: the team name is beside it. */}
              <SleeperAvatar avatarId={leader.team.ownerAvatarId} title="" size={32} />
              <p className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {leader.team.teamName}
                </span>
                {leader.team.ownerLabel ? (
                  <span className="block truncate text-[11px] text-ink-subtle">
                    {leader.team.ownerLabel}
                  </span>
                ) : null}
              </p>
              <p
                className={`shrink-0 font-mono text-base font-extrabold tabular-nums ${theme.text}`}
              >
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
