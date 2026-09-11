import { ImageWithFallback } from "@/components/image-with-fallback";

/**
 * An NFL team's logo, from the Sleeper CDN the site already loads player
 * photos from (next.config.ts allows sleepercdn.com). The same path
 * lib/og/assets.ts uses for a defence's image.
 *
 * ALWAYS DECORATIVE. Every caller prints the team code as visible text right
 * beside the logo, so the image carries alt="" and the code carries the
 * meaning. A logo is never the only place a team is named.
 *
 * The code is VALIDATED rather than trusted, the same rule lib/og/assets.ts
 * applies: it arrives from stored source data, so anything that is not two
 * to four letters renders nothing rather than letting a stored string choose
 * the path. A leading "@" (the away marker opponentLabel honours) is
 * stripped first.
 *
 * A logo that fails to load leaves an empty square of the same size, so the
 * line it sits in never shifts.
 */

const TEAM_CODE_PATTERN = /^[A-Za-z]{2,4}$/;

export function nflTeamLogoUrl(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim().replace(/^@/, "");
  if (!TEAM_CODE_PATTERN.test(trimmed)) return null;
  return `https://sleepercdn.com/images/team_logos/nfl/${trimmed.toLowerCase()}.png`;
}

export function NflTeamLogo({
  team,
  size = 20,
  className = "",
}: {
  team: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const src = nflTeamLogoUrl(team);
  if (!src) return null;
  return (
    <ImageWithFallback
      src={src}
      alt=""
      size={size}
      radiusClass="rounded-none"
      className={`!border-0 !bg-transparent !object-contain ${className}`}
      fallback={<span />}
    />
  );
}
