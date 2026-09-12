/**
 * Team Anthem: a compact pennant on the player hero that flows the player's NFL
 * team brand colors (from the nfl_teams table) behind the team's crowd chant.
 * The three colors power two stacked animated layers: a flowing gradient sweep
 * and drifting, pulsing color spotlights (a "stadium lights" feel), with a soft
 * trophy-shine passing over the top, and the team's own crest oversized and
 * tilted behind all of it. Colors stay vivid, so different teams read
 * as visibly different banners. Legibility is handled locally: the chant sits on
 * a faded-black, lightly blurred plate, so white text stays readable no matter
 * how light a team color is (rather than darkening the whole banner and muddying
 * the colors). All animation halts under prefers-reduced-motion, leaving a
 * static but still fully colored, legible banner (see globals.css .team-anthem*).
 * Purely presentational, so it renders on the server.
 */

import type { CSSProperties } from "react";
import { Megaphone } from "lucide-react";
import { nflTeamLogoUrl } from "@/components/nfl-team-logo";
import type { NflTeamRow } from "@/lib/player-profile";

export function TeamAnthem({ team }: { team: NflTeamRow }) {
  // The crest watermark. Decorative: the team is named in the section label,
  // in the plate under the chant, and again in the hero's team chip, so the
  // image carries no meaning of its own. nflTeamLogoUrl validates the code,
  // so a stored string can never choose the path.
  const crest = nflTeamLogoUrl(team.abbreviation);
  // Custom properties feed both animated color layers in globals.css.
  const colorStyle = {
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
      style={colorStyle}
      className="team-anthem relative isolate overflow-hidden rounded-modal border border-line"
    >
      {/* 1. Base flowing team-color gradient. */}
      <div aria-hidden="true" className="team-anthem-sweep absolute inset-0" />
      {/* 2. Drifting, pulsing team-color spotlights for depth and motion. */}
      <div aria-hidden="true" className="team-anthem-glow absolute inset-0" />
      {/* 3. The team crest, tilted off-axis in the open space to the right of
             the chant, so the band reads as having a back wall behind the
             color rather than a flat fill. It sits clear of the swatch column
             rather than behind it, which only made both harder to read. One
             <img>, no animation of its own: the sheen in
             .team-anthem::after passes over it for free, and the file is the
             same URL the hero's team chip already loads, so the browser
             fetches and decodes it once for both. */}
      {crest && (
        // eslint-disable-next-line @next/next/no-img-element -- external CDN
        // image; next/image buys nothing for a fixed-size decorative layer.
        <img
          src={crest}
          alt=""
          aria-hidden="true"
          width={200}
          height={200}
          decoding="async"
          loading="lazy"
          className="team-anthem-crest pointer-events-none absolute right-10 top-1/2 h-[145px] w-[145px] -translate-y-1/2 -rotate-[14deg] select-none object-contain sm:right-[4.5rem] sm:h-[170px] sm:w-[170px]"
        />
      )}
      {/* 4. Soft corner vignette for framing (keeps the center colors vivid). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(125% 125% at 28% 35%, transparent 42%, rgba(0,0,0,0.45) 100%)",
        }}
      />

      <div className="relative flex items-center justify-between gap-4 px-5 py-4">
        {/* Localized faded-black plate keeps the chant legible over any color. */}
        <div className="min-w-0 max-w-full rounded-xl bg-black/45 px-4 py-2.5 shadow-lg ring-1 ring-white/10 backdrop-blur-[2px]">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/75">
            <Megaphone aria-hidden="true" className="h-3.5 w-3.5" />
            Team chant
          </p>
          <p
            className="mt-1 truncate text-2xl font-black uppercase tracking-wide text-white sm:text-3xl"
            style={{ textShadow: "0 2px 16px rgba(0,0,0,0.85)" }}
          >
            {team.chant}
          </p>
          <p className="mt-0.5 text-xs font-medium text-white/75">{team.name}</p>
        </div>

        {/* The three team colors, explicit as swatches (decorative; the colors
            carry no independent meaning a reader needs beyond the team name). */}
        <ul aria-hidden="true" className="flex shrink-0 flex-col gap-1.5">
          {swatches.map((s) => (
            <li
              key={s.label}
              className="h-4 w-9 rounded-full shadow-sm ring-1 ring-inset ring-white/50"
              style={{ backgroundColor: s.color }}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
