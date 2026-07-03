/**
 * Player hero header. A large headshot floats on a glow (no border, soft
 * drop-shadow) so it reads as a profile rather than a stock photo, beside the
 * player identity (name, position, team, status) and their last three
 * positional finishes for the active format's scoring. A full-width Team Anthem
 * band closes the hero with the team's colors and crowd chant. Server component.
 */

import Link from "next/link";
import { PlayerPortrait } from "@/components/player-profile/player-portrait";
import { TeamAnthem } from "@/components/player-profile/team-anthem";
import { LastThreeFinishes } from "@/components/player-profile/positional-finishes";
import { RoleBadge } from "@/components/player-profile/role-badge";
import type { NflTeamRow, PlayerRow, PositionalFinish } from "@/lib/player-profile";

function positionAccent(position: string): string {
  const pos = (position ?? "").toUpperCase();
  if (pos === "QB") return "#F87171";
  if (pos === "RB") return "#34D399";
  if (pos === "WR") return "#60A5FA";
  if (pos === "TE") return "#FBBF24";
  if (pos === "K") return "#F472B6";
  if (pos === "DEF") return "#94A3B8";
  return "#A8A8B8";
}

export function PlayerHero({
  player,
  sleeperId,
  scoringLabel,
  finishes,
  team,
  role,
}: {
  player: PlayerRow;
  sleeperId: string | null;
  scoringLabel: string;
  finishes: PositionalFinish[];
  team: NflTeamRow | null;
  role: string | null;
}) {
  const fullName = player.full_name ?? `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
  const accent = positionAccent(player.position);
  // The team's primary color pools behind the photo; fall back to the position
  // accent for free agents / unmapped teams.
  const teamColor = team?.primary_color ?? accent;

  return (
    <header className="relative overflow-hidden border-b border-line">
      {/* Beacon hairline + a position-tinted corner wash. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-beacon" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-0 h-[380px] w-[680px]"
        style={{
          background: `radial-gradient(ellipse at 72% 0%, ${accent}22 0%, rgba(34,211,238,0.06) 45%, transparent 75%)`,
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <nav aria-label="Breadcrumb" className="mb-6 text-sm text-ink-muted">
          <ol className="flex items-center gap-2">
            <li>
              <Link href="/" className="hover:text-ink">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href={`/rankings?position=${player.position}`} className="hover:text-ink">
                {player.position}
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-ink">
              {fullName}
            </li>
          </ol>
        </nav>

        {/* Player photo beside the identity; the full-width Team Anthem banner
            sits below with breathing room. The headshot is a large rounded
            photo shown in full (object-contain, no crop) with no border. */}
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-7">
          <PlayerPortrait
            sleeperId={sleeperId}
            name=""
            accentColor={teamColor}
            className="shrink-0 drop-shadow-[0_16px_34px_rgba(0,0,0,0.5)]"
          />

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="mb-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-[0.16em]"
                style={{ backgroundColor: `${accent}22`, color: accent }}
              >
                {player.position}
              </span>
              {player.team && (
                <span className="inline-flex items-center rounded-md bg-base px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  {player.team}
                </span>
              )}
              {player.status && player.status !== "active" && (
                <span className="inline-flex items-center rounded-md bg-signal-warning/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-signal-warning">
                  {player.status.replace(/_/g, " ")}
                </span>
              )}
              {role && <RoleBadge role={role} />}
            </div>

            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
              {fullName}
            </h1>

            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                Last 3 finishes
                <span className="ml-1.5 font-medium normal-case tracking-normal text-ink-subtle">
                  ({scoringLabel})
                </span>
              </p>
              <div className="flex justify-center sm:justify-start">
                <LastThreeFinishes position={player.position} finishes={finishes} />
              </div>
            </div>
          </div>
        </div>

        {/* Full-width Team Anthem banner with spacing above it. */}
        {team && (
          <div className="mt-7">
            <TeamAnthem team={team} />
          </div>
        )}
      </div>
    </header>
  );
}
