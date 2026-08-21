"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, ArrowDown, LayoutGrid, Gamepad2 } from "lucide-react";
import { DiscordGlyph } from "@/components/discord-glyph";

/**
 * Primary hero call-to-action that adapts to Discord guild membership.
 *
 * - NOT a confirmed member (or membership unknown, or no Discord linked):
 *   renders the standard "Join our Discord" button, byte-identical in look to
 *   the static markup it replaces so anonymous visitors see no change.
 * - Confirmed member: the Discord invite is wasted real estate, so we swap in
 *   a more useful primary action:
 *     - mode="link": an internal Link (e.g. "Explore our fantasy tools" -> /tools,
 *       or "Explore our free games" -> /games).
 *     - mode="scroll": on a tool's own page, a button that smooth-scrolls down
 *       to the tool's content/form (e.g. "Start drafting" on On The Clock),
 *       respecting prefers-reduced-motion.
 *
 * `isMember` is resolved server-side by the parent page and passed in, so there
 * is no client fetch and no post-hydration flash for the common (anonymous)
 * case. Icons are passed by name (not as components) because this is a client
 * boundary.
 */

type IconName = "arrow-right" | "arrow-down" | "tools" | "games";

const ICONS: Record<IconName, typeof ArrowRight> = {
  "arrow-right": ArrowRight,
  "arrow-down": ArrowDown,
  tools: LayoutGrid,
  games: Gamepad2,
};

type Size = "lg" | "md";

const SIZE_PAD: Record<Size, string> = {
  lg: "px-5 py-3",
  md: "px-4 py-2.5",
};

const PRIMARY_BASE =
  "inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

type MemberHeroCtaProps = {
  isMember: boolean;
  size?: Size;
  /** How the member-facing button behaves. */
  memberMode: "link" | "scroll";
  memberLabel: string;
  /** Required when memberMode === "link". */
  memberHref?: Route;
  /** Required when memberMode === "scroll": id of the element to scroll to. */
  memberScrollTargetId?: string;
  memberIcon?: IconName;
  /**
   * Label for the non-member invite. Shortened on pages whose hero has to keep
   * two buttons on one line at phone width; everywhere else keeps the longer
   * default.
   */
  joinLabel?: string;
};

export function MemberHeroCta({
  isMember,
  size = "lg",
  memberMode,
  memberLabel,
  memberHref,
  memberScrollTargetId,
  memberIcon = "arrow-right",
  joinLabel = "Join our Discord",
}: MemberHeroCtaProps) {
  const className = `${PRIMARY_BASE} ${SIZE_PAD[size]}`;

  // Default: the standard Join our Discord invite (unchanged for everyone we
  // have not positively confirmed as a member).
  if (!isMember) {
    return (
      <a
        href="/join"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${joinLabel} (opens in new tab)`}
        className={className}
      >
        <DiscordGlyph className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} />
        {joinLabel}
      </a>
    );
  }

  const Icon = ICONS[memberIcon];

  if (memberMode === "scroll" && memberScrollTargetId) {
    return (
      <button
        type="button"
        onClick={() => scrollToId(memberScrollTargetId)}
        className={className}
      >
        {memberLabel}
        <Icon aria-hidden="true" className="h-4 w-4" />
      </button>
    );
  }

  // Link mode (also the fallback if a scroll target was somehow omitted).
  return (
    <Link href={memberHref ?? ("/tools" as Route)} className={className}>
      <Icon aria-hidden="true" className="h-4 w-4" />
      {memberLabel}
    </Link>
  );
}

/** Smooth-scroll to an element id, honoring reduced-motion preferences. */
function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({
    behavior: prefersReduced ? "auto" : "smooth",
    block: "start",
  });
}
