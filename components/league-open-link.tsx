"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLeagueWarmup } from "@/lib/use-league-warmup";

/**
 * A link into a league's deep view that starts that league's sync on hover or
 * keyboard focus, so the click lands on work already in progress.
 *
 * Otherwise an ordinary `<Link>`: same navigation, same styling hooks, same
 * accessible name. The warm-up is invisible and optional, and the link behaves
 * identically if it never fires. See lib/use-league-warmup.ts.
 */
export function LeagueOpenLink({
  sleeperLeagueId,
  href,
  className,
  ariaLabel,
  children,
}: {
  sleeperLeagueId: string;
  href: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const warm = useLeagueWarmup(sleeperLeagueId);
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={className}
      onPointerEnter={warm.onPointerEnter}
      onPointerLeave={warm.onPointerLeave}
      onFocus={warm.onFocus}
    >
      {children}
    </Link>
  );
}
