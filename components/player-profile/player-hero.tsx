/**
 * Player masthead. Same card as PageMasthead (rounded-modal, line-accent
 * border, beacon radial wash, top hairline, .beacon-page-title h1), with one
 * addition the shared props cannot express: a large headshot floating on a glow
 * to the left of the identity column. Beside it sit the position, team, status,
 * and depth-role badges, then the player's last three positional finishes for
 * the active format's scoring. The team crest appears twice, at two strengths:
 * sharp inside the team chip, and ghosted into the top-right corner as
 * texture. A Team Anthem band in the team's colors closes the card. Server
 * component.
 */

import {
  MastheadCard,
  MASTHEAD_TITLE_SIZE,
} from "@/components/app-shell/masthead-card";
import { PlayerPortrait } from "@/components/player-profile/player-portrait";
import { NflTeamLogo, nflTeamLogoUrl } from "@/components/nfl-team-logo";
import { TeamAnthem } from "@/components/player-profile/team-anthem";
import { LastThreeFinishes } from "@/components/player-profile/positional-finishes";
import { RoleBadge } from "@/components/player-profile/role-badge";
import type {
  NflTeamRow,
  PlayerRow,
  PositionalFinish,
} from "@/lib/player-profile";

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
  const fullName =
    player.full_name ??
    `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
  const accent = positionAccent(player.position);
  // The team's primary color pools behind the photo; fall back to the position
  // accent for free agents / unmapped teams.
  const teamColor = team?.primary_color ?? accent;

  // Last-3-finishes block, rendered in the identity column beside the photo.
  const finishesBlock = (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        Last 3 finishes
        <span className="ml-1.5 font-medium normal-case tracking-normal text-ink-subtle">
          ({scoringLabel})
        </span>
      </p>
      <div>
        <LastThreeFinishes
          position={player.position}
          finishes={finishes}
          compact
        />
      </div>
    </div>
  );

  // The crest that ghosts into the masthead corner. Decorative at every turn:
  // the team is named in the chip below it and again in the anthem band, and
  // nflTeamLogoUrl validates the code rather than trusting a stored string.
  const crest = nflTeamLogoUrl(player.team);

  return (
    <MastheadCard labelledBy="player-masthead-title">
      {/* The team crest, ghosted and tilted into the top-right corner, under
          the position wash. It sits at texture strength (5%), so it fills the
          empty corner with the player's team without competing with anything
          in front of it. The same URL the team chip and the anthem band load,
          so all three share one fetch and one decode. Static: no animation,
          no layout cost, one small PNG. */}
      {crest && (
        // eslint-disable-next-line @next/next/no-img-element -- external CDN
        // image; next/image buys nothing for a fixed-size decorative layer.
        <img
          src={crest}
          alt=""
          aria-hidden="true"
          width={360}
          height={360}
          decoding="async"
          loading="lazy"
          className="player-hero-crest pointer-events-none absolute -right-10 -top-8 h-[230px] w-[230px] -rotate-[10deg] select-none object-contain sm:h-[360px] sm:w-[360px]"
        />
      )}

      {/* Position-tinted corner wash, so the team color still reads on a
          player's card. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-0 h-[380px] w-[680px]"
        style={{
          background: `radial-gradient(ellipse at 72% 0%, ${accent}22 0%, rgba(34,211,238,0.06) 45%, transparent 75%)`,
        }}
      />

      <div className="relative p-5 sm:p-6 lg:p-7">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-cyan">
          Players
        </p>

        {/* Player photo beside the identity; the Team Anthem banner sits below
            with breathing room. The headshot is a rounded photo shown in full
            (object-contain, no crop) with no border. On mobile the name and
            badges sit to the RIGHT of a slightly smaller photo to save vertical
            space. */}
        <div className="mt-3 flex items-center gap-4 sm:gap-7">
          <PlayerPortrait
            sleeperId={sleeperId}
            name=""
            accentColor={teamColor}
            className="shrink-0 drop-shadow-[0_16px_34px_rgba(0,0,0,0.5)]"
          />

          <div className="min-w-0 flex-1 text-left">
            <div className="mb-2 flex flex-wrap items-center justify-start gap-2">
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-[0.16em]"
                style={{ backgroundColor: `${accent}22`, color: accent }}
              >
                {player.position}
              </span>
              {player.team && (
                /* Crest chip: the team logo sits inside the team badge, the
                   same pairing Who Should I Start uses (logo decorative, the
                   code beside it carries the meaning). The chip is tinted with
                   the team's own primary color when we have the nfl_teams row,
                   so the badge row picks up the team's brand rather than
                   sitting in neutral grey. */
                <span
                  className="inline-flex items-center gap-1.5 rounded-md border border-line/70 bg-base px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-ink-muted"
                  style={
                    team
                      ? {
                          backgroundColor: `${team.primary_color}1F`,
                          borderColor: `${team.primary_color}59`,
                        }
                      : undefined
                  }
                >
                  <NflTeamLogo team={player.team} size={16} />
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

            <h1
              id="player-masthead-title"
              className={`beacon-page-title ${MASTHEAD_TITLE_SIZE}`}
            >
              {fullName}
            </h1>

            {/* Finishes sit in the identity column beside the photo at every
                breakpoint. */}
            <div className="mt-4">{finishesBlock}</div>
          </div>
        </div>

        {/* Team Anthem banner with spacing above it. */}
        {team && (
          <div className="mt-6">
            <TeamAnthem team={team} />
          </div>
        )}
      </div>
    </MastheadCard>
  );
}
