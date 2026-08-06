/**
 * The matchup header: two premium, visually balanced player cards with a
 * centered "VS" badge. Each card shows identity (headshot, name, position,
 * team, age) plus the three headline signals (FF Beacon value, overall rank,
 * tier) and a 30-day value-trend chip. Server component.
 */

import Link from "next/link";
import { PlayerHeadshot } from "@/components/player-headshot";
import { BeaconValue } from "@/components/beacon-value-icon";
import type { BreakdownPlayer } from "@/lib/beacon-breakdown";

const POS_TEXT: Record<string, string> = {
  QB: "text-position-qb",
  RB: "text-position-rb",
  WR: "text-position-wr",
  TE: "text-position-te",
  K: "text-position-k",
  DEF: "text-position-def",
};

const POS_BG: Record<string, string> = {
  QB: "bg-position-qb/15 text-position-qb",
  RB: "bg-position-rb/15 text-position-rb",
  WR: "bg-position-wr/15 text-position-wr",
  TE: "bg-position-te/15 text-position-te",
  K: "bg-position-k/15 text-position-k",
  DEF: "bg-position-def/15 text-position-def",
};

function posBg(position: string): string {
  return POS_BG[position.toUpperCase()] ?? "bg-ink-subtle/15 text-ink-muted";
}

export function MatchupHeader({
  a,
  b,
  valueIsBeacon,
}: {
  a: BreakdownPlayer;
  b: BreakdownPlayer;
  valueIsBeacon: boolean;
}) {
  return (
    <div className="grid items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
      <PlayerCard player={a} accent="purple" valueIsBeacon={valueIsBeacon} />

      <div className="flex items-center justify-center" aria-hidden="true">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 text-sm font-bold tracking-wider text-ink"
          style={{
            borderColor: "transparent",
            backgroundImage:
              "linear-gradient(#0F0F1A, #0F0F1A), linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            backgroundOrigin: "border-box",
            backgroundClip: "padding-box, border-box",
          }}
        >
          VS
        </span>
      </div>

      <PlayerCard player={b} accent="cyan" valueIsBeacon={valueIsBeacon} />
    </div>
  );
}

function PlayerCard({
  player,
  accent,
  valueIsBeacon,
}: {
  player: BreakdownPlayer;
  accent: "purple" | "cyan";
  valueIsBeacon: boolean;
}) {
  const edgeColor = accent === "purple" ? "#A855F7" : "#22D3EE";
  const posText = POS_TEXT[player.position.toUpperCase()] ?? "text-ink-muted";
  // The team's brand color drives the bottom gradient; fall back to the card's
  // assigned beacon color for free agents / unmapped teams.
  const teamColor = player.teamPrimary ?? edgeColor;

  return (
    <section
      aria-label={`${player.name} summary`}
      className="relative flex flex-col overflow-hidden rounded-modal border border-line bg-surface/60"
    >
      {/* Top-edge accent in the card's assigned brand color. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-10 h-0.5"
        style={{ backgroundColor: edgeColor }}
      />

      <div className="px-5 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${posBg(
              player.position,
            )}`}
          >
            {player.position}
          </span>
          {player.team && (
            <span className="text-xs font-medium text-ink-muted">{player.team}</span>
          )}
          {player.ageDecimal != null && (
            <span className="text-xs text-ink-subtle">
              Age {player.ageDecimal.toFixed(1)}
            </span>
          )}
        </div>
        <Link
          href={`/players/${player.slug}`}
          className="mt-1 block truncate text-xl font-semibold text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:text-2xl"
        >
          {player.name}
        </Link>

        <dl className="mt-4 grid grid-cols-3 gap-2">
          <StatCell
            label="Value"
            value={
              player.value != null && player.value > 0 ? (
                <BeaconValue show={valueIsBeacon}>{player.value.toLocaleString()}</BeaconValue>
              ) : (
                "-"
              )
            }
          />
          <StatCell
            label="Overall"
            value={player.overallRank != null ? `#${player.overallRank}` : "-"}
          />
          <StatCell
            label="Tier"
            value={player.tier != null ? `T${player.tier}` : "-"}
            valueClass={player.tier != null ? posText : undefined}
          />
        </dl>

        <TrendLine change={player.change30d} pct={player.change30dPct} dir={player.trend30d} />
      </div>

      {/* Photo stage: a team-color gradient rising from the bottom of the card,
          with the square headshot bottom-aligned so the player looks like they
          are standing on the color wash. `mt-auto` pins the stage to the card
          bottom so both cards stay flush regardless of content height. */}
      <div className="relative mt-4 flex h-44 items-end justify-center overflow-hidden">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(to top, ${teamColor}F2 0%, ${teamColor}80 32%, ${teamColor}26 58%, transparent 82%)`,
          }}
        />
        {/* The one deliberate exception to the shared player-photo radius: this
            is a full-bleed cutout standing in the team-colored wash, not a photo
            sitting in a frame, so it carries no shape, border, or backdrop. */}
        <PlayerHeadshot
          sleeperId={player.sleeperId}
          name=""
          size={168}
          className="relative !rounded-none !border-0 !bg-transparent drop-shadow-[0_12px_24px_rgba(0,0,0,0.5)]"
        />
      </div>
    </section>
  );
}

function StatCell({
  label,
  value,
  valueClass = "text-ink",
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-card border border-line/60 bg-base/50 px-2.5 py-2 text-center">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-[1rem] font-bold tabular-nums ${valueClass}`}>
        {value}
      </dd>
    </div>
  );
}

function TrendLine({
  change,
  pct,
  dir,
}: {
  change: number | null;
  pct: number | null;
  dir: "up" | "down" | "stable" | null;
}) {
  if (dir == null || change == null) {
    return (
      <p className="mt-3 text-xs text-ink-subtle">30-day trend: not enough history yet</p>
    );
  }
  const tone =
    dir === "up"
      ? "text-signal-success"
      : dir === "down"
        ? "text-signal-warning"
        : "text-ink-muted";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "→";
  const sign = change > 0 ? "+" : "";
  const pctText = pct != null ? ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)` : "";
  const label =
    dir === "up" ? "rising" : dir === "down" ? "falling" : "stable";
  return (
    <p
      className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${tone}`}
      aria-label={`30-day value trend ${label}: ${sign}${change.toLocaleString()}${pctText}`}
    >
      <span aria-hidden="true">{arrow}</span>
      <span aria-hidden="true">
        {sign}
        {change.toLocaleString()}
        {pctText} over 30 days
      </span>
    </p>
  );
}
