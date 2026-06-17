import type { ReactNode } from "react";
import { accentInkColor } from "@/lib/signal/accents";

/**
 * Spotlight (Layout C) card chrome: a luminous "beacon" container that wraps any
 * existing profile block (FeaturedBoardBlock, FeaturedLeagueBlock, LinksBlock,
 * FavoritesBlock, TextBlock) without changing its semantics. The block keeps its
 * own <section>, heading, and links; BeaconCard only adds the glowing surround,
 * so there is no duplicate data path and graceful degrade is inherited from the
 * wrapped block (a block that resolves to null simply renders no card).
 *
 * The glow is FULLY STATIC: a soft accent box-shadow plus a one-pixel accent
 * top hairline, both decorative (aria-hidden where applicable) and rendered with
 * no keyframes. There is nothing for reduced-motion to disable, which is the
 * deliberate "static-safe" choice for the beacon effect. Contrast is unaffected:
 * the accent is used only as a decorative shadow/border (accentInkColor is the
 * AAA-on-dark hex), while all text inside the wrapped block keeps its own colors.
 */
export function BeaconCard({
  accent,
  children,
}: {
  accent: string;
  children: ReactNode;
}) {
  const hex = accentInkColor(accent);
  return (
    <div
      className="relative overflow-hidden rounded-card border border-line bg-surface px-5 sm:px-6"
      // Soft, static accent glow. Negative spread keeps it a gentle halo rather
      // than a hard ring; the 8-digit alpha suffix keeps it subtle on dark.
      style={{ boxShadow: `0 0 36px -16px ${hex}99` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${hex}, transparent)` }}
      />
      {children}
    </div>
  );
}
