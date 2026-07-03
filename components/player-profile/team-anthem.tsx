/**
 * Team Anthem: a compact pennant on the player hero that flows the player's NFL
 * team brand colors (from the nfl_teams table) behind the team's crowd chant.
 * The three colors drift across the banner via a looping gradient sweep and a
 * soft trophy-shine passes over it; both animations halt under reduced motion,
 * leaving a static but still fully colored, legible banner (see globals.css
 * .team-anthem-sweep / .team-anthem). A left-weighted dark scrim keeps the white
 * chant readable no matter how light a team color is. Purely presentational, so
 * it renders on the server.
 */

import type { CSSProperties } from "react";
import { Megaphone } from "lucide-react";
import type { NflTeamRow } from "@/lib/player-profile";

export function TeamAnthem({ team }: { team: NflTeamRow }) {
  // Custom properties feed the animated gradient in globals.css.
  const sweepStyle = {
    "--anthem-c1": team.primary_color,
    "--anthem-c2": team.secondary_color,
    "--anthem-c3": team.tertiary_color,
  } as CSSProperties;

  const swatches: { label: string; color: string }[] = [
    { label: "primary", color: team.primary_color },
    { label: "secondary", color: team.secondary_color },
    { label: "tertiary", color: team.tertiary_color },
  ];

  return (
    <section
      aria-label={`${team.name} team chant: ${team.chant}`}
      className="team-anthem relative isolate overflow-hidden rounded-modal border border-line"
    >
      {/* Flowing team-color gradient. */}
      <div aria-hidden="true" className="team-anthem-sweep absolute inset-0" style={sweepStyle} />
      {/* Legibility scrim, darkest under the chant on the left. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-base/90 via-base/55 to-base/25"
      />

      <div className="relative flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">
            <Megaphone aria-hidden="true" className="h-3.5 w-3.5" />
            Team chant
          </p>
          <p
            className="mt-1 truncate text-2xl font-black uppercase tracking-wide text-white sm:text-3xl"
            style={{ textShadow: "0 2px 14px rgba(0,0,0,0.65)" }}
          >
            {team.chant}
          </p>
          <p className="mt-0.5 text-xs font-medium text-white/70">{team.name}</p>
        </div>

        {/* The three team colors, explicit as swatches (decorative; the colors
            carry no independent meaning a reader needs beyond the team name). */}
        <ul aria-hidden="true" className="flex shrink-0 flex-col gap-1.5">
          {swatches.map((s) => (
            <li
              key={s.label}
              className="h-4 w-9 rounded-full ring-1 ring-inset ring-white/40"
              style={{ backgroundColor: s.color }}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
