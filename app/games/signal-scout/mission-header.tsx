/**
 * The header a round runs under, in place of the page masthead.
 *
 * The masthead explains what Signal Scout is, which is the wrong thing to read
 * while a round is live, so the game takes it away (see `masthead` in
 * signal-scout-client.tsx). Something has to stand where it stood: this is the
 * page's h1 for as long as a round is on screen, and it says where you are in
 * the round rather than what the game is.
 *
 * Presentational server component.
 */

import { Radar, FileCheck2 } from "lucide-react";

const VARIANTS = {
  active: {
    icon: Radar,
    eyebrow: "Mission active",
    title: "The signal is live",
    body: "Read the file, buy only the hints you need, and name the player before the score runs out.",
    accent: "#22D3EE",
  },
  complete: {
    icon: FileCheck2,
    eyebrow: "Mission report",
    title: "Round complete",
    body: "The file is unredacted below. Start another round whenever you are ready.",
    accent: "#A855F7",
  },
} as const;

export function MissionHeader({ variant }: { variant: keyof typeof VARIANTS }) {
  const v = VARIANTS[variant];
  const Icon = v.icon;
  return (
    <header
      className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/40 p-4 sm:p-5"
      style={{
        backgroundImage: `radial-gradient(ellipse at 0% 0%, ${v.accent}22 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 60%)`,
      }}
    >
      {/* Top-edge beacon hairline, decorative, matching every other masthead. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="relative flex items-start gap-3 sm:items-center sm:gap-4">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border bg-base sm:h-12 sm:w-12"
          style={{ borderColor: `${v.accent}66`, color: v.accent }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.22em]"
            style={{ color: v.accent }}
          >
            {v.eyebrow}
          </p>
          <h1 className="beacon-page-title mt-1 text-[clamp(1.35rem,3.2vw,2.25rem)]">
            {v.title}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {v.body}
          </p>
        </div>
      </div>
    </header>
  );
}
