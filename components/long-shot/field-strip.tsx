"use client";

/**
 * The field strip (plan 18A.1): a football field drawn as a strip of light,
 * every answer landing on it as far downfield as its rarity. Geometry lives in
 * lib/long-shot/field-geometry.ts.
 *
 * The SVG is illustration (role="img" with the full answer list as its name);
 * the record is the <ol> directly under it, always present at every width.
 *
 * Motion: a newly added marker flies from the line (x 40) to its landing x in
 * 600 ms. When the player has an NFL team it leaves a two-tone trail in that
 * team's colors that fades after the flight and is then removed, and a Long
 * Shot landing flashes the end zone once. Under prefers-reduced-motion
 * nothing moves: the marker appears in place inside a fading two-color ring.
 * The trail, flash and ring are aria-hidden; the team is named as text
 * elsewhere, so the colors add nothing a reader needs.
 */

import { useEffect, useId, useState } from "react";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { PlayerHeadshot } from "@/components/player-headshot";
import {
  CENTER_Y,
  MARKER_R,
  MISS_X,
  fieldStripLabel,
  markerPositions,
  trailPaths,
  type FieldMarker,
} from "@/lib/long-shot/field-geometry";
import { MISS_STYLE, TIER_STYLE } from "@/lib/long-shot/tier-style";
import type { TeamTonesDto, Tier } from "@/lib/long-shot/types";
import { useReducedMotion } from "@/lib/long-shot/use-reduced-motion";

export interface StripRecord extends FieldMarker {
  points: number;
  playerName: string | null;
  sleeperId?: string | null;
  teamCode?: string | null;
  state?: "answered" | "timed_out" | "skipped" | "pending";
}

export interface FlightSpec {
  position: number;
  tier: Tier | null;
  team: TeamTonesDto | null;
}

export function FieldStrip({
  records,
  total,
  size = "full",
  flight = null,
  showHeadshots = false,
  labelMarkers = false,
}: {
  records: StripRecord[];
  total: number;
  size?: "small" | "full";
  flight?: FlightSpec | null;
  showHeadshots?: boolean;
  labelMarkers?: boolean;
}) {
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const beaconId = `ls-strip-beacon-${uid}`;
  const xs = markerPositions(records);
  const [phase, setPhase] = useState<"start" | "flying" | "fading" | "done">(flight ? "start" : "done");
  // The effect keys on this string, not on the flight object: the result panel
  // rebuilds that object on every render while its points count up, and an
  // object dependency restarted the flight sixty times a second for as long
  // as the count-up ran.
  const flightKey = flight ? `${flight.position}:${flight.tier ?? "miss"}` : null;

  useEffect(() => {
    if (!flightKey) return;
    setPhase("start");
    // Two frames so the start position paints before the transition runs.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPhase("flying"));
    });
    const t1 = setTimeout(() => setPhase("fading"), 600);
    const t2 = setTimeout(() => setPhase("done"), 1000);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [flightKey]);

  const flightX = flight ? (xs.get(flight.position) ?? MISS_X) : 0;
  const flies = Boolean(flight && flight.tier && !reduced);
  const label = fieldStripLabel(records, total);
  const heightClass = size === "small" ? "max-h-[72px]" : "";

  return (
    <div className="w-full">
      <svg
        viewBox="0 0 1000 120"
        role="img"
        aria-label={label}
        className={`block w-full ${heightClass}`}
        // The small strip is height-capped, so its drawing is narrower than
        // its box; pinning it left keeps it over the record list beneath it.
        preserveAspectRatio={size === "small" ? "xMinYMid meet" : "xMidYMid meet"}
      >
        <defs>
          <linearGradient id={beaconId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#A855F7" />
            <stop offset="1" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="1000" height="120" rx="14" fill="#0B0B14" />
        <rect x="0" y="0" width="100" height="120" fill="#8A8A9C" opacity="0.08" />
        <rect x="900" y="0" width="100" height="120" fill={`url(#${beaconId})`} opacity="0.22" />
        {flight?.tier === "long_shot" && flight.team && !reduced && phase !== "done" && (
          <g aria-hidden="true" className="ls-flash">
            <rect x="900" y="0" width="50" height="120" fill={flight.team.primary} />
            <rect x="950" y="0" width="50" height="120" fill={flight.team.secondary} />
          </g>
        )}
        {Array.from({ length: 9 }, (_, i) => (i + 1) * 100).map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="120" stroke="#2A2A47" strokeWidth="2" />
        ))}
        {Array.from({ length: 9 }, (_, i) => i * 100 + 150).map((x) => (
          <g key={x} stroke="#1F1F33" strokeWidth="2">
            <line x1={x} y1="27" x2={x} y2="33" />
            <line x1={x} y1="87" x2={x} y2="93" />
          </g>
        ))}
        <text
          // At the end zone's right edge, clear of a Long Shot marker landing at 950.
          x="988"
          y="60"
          transform="rotate(-90 988 60)"
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="var(--font-geist-mono), ui-monospace, monospace"
          fontWeight="900"
          fontSize="14"
          fill="#22D3EE"
          opacity="0.7"
          aria-hidden="true"
        >
          LONG SHOT
        </text>

        {flight && flies && flight.team && phase !== "done" && (
          <g
            aria-hidden="true"
            className="ls-trail"
            style={{
              transformOrigin: `${MISS_X}px ${CENTER_Y}px`,
              transform: phase === "start" ? "scaleX(0)" : "scaleX(1)",
              opacity: phase === "fading" ? 0 : 0.85,
              transition:
                phase === "flying"
                  ? "transform 600ms cubic-bezier(0.16, 1, 0.3, 1)"
                  : phase === "fading"
                    ? "opacity 400ms linear"
                    : "none",
            }}
          >
            <path d={trailPaths(MISS_X, flightX).upper} fill={flight.team.primary} />
            <path d={trailPaths(MISS_X, flightX).lower} fill={flight.team.secondary} />
          </g>
        )}

        {records.map((r) => {
          const x = xs.get(r.position) ?? MISS_X;
          const isFlight = flight?.position === r.position;
          if (r.pending) {
            return (
              <circle key={r.position} cx={x} cy={CENTER_Y} r={MARKER_R - 2} fill="none" stroke="#2A2A47" strokeWidth="3" />
            );
          }
          const style = r.tier ? TIER_STYLE[r.tier] : null;
          const offset = isFlight && flies && phase === "start" ? MISS_X - x : 0;
          return (
            <g
              key={r.position}
              style={{
                transform: `translateX(${offset}px)`,
                transition: isFlight && flies && phase !== "start" ? "transform 600ms cubic-bezier(0.16, 1, 0.3, 1)" : "none",
              }}
            >
              {isFlight && reduced && flight?.team && phase !== "done" && (
                <g aria-hidden="true" className="ls-ring-fade">
                  <path d={`M ${x} ${CENTER_Y - 22} A 22 22 0 0 0 ${x} ${CENTER_Y + 22}`} stroke={flight.team.primary} strokeWidth="3" fill="none" />
                  <path d={`M ${x} ${CENTER_Y - 22} A 22 22 0 0 1 ${x} ${CENTER_Y + 22}`} stroke={flight.team.secondary} strokeWidth="3" fill="none" />
                </g>
              )}
              <circle
                cx={x}
                cy={CENTER_Y}
                r={MARKER_R}
                fill={style ? (r.tier === "long_shot" ? `url(#${beaconId})` : style.hex) : "none"}
                stroke={style ? "#07070D" : MISS_STYLE.hex}
                strokeWidth="3"
              />
              <text
                x={x}
                y={CENTER_Y}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="var(--font-geist-sans), system-ui, sans-serif"
                fontWeight="700"
                fontSize="16"
                fill={style ? style.onMarker : MISS_STYLE.hex}
                aria-hidden="true"
              >
                {r.position}
              </text>
              {labelMarkers && (
                <text
                  x={x}
                  y={CENTER_Y + 34}
                  textAnchor="middle"
                  fontFamily="var(--font-geist-sans), system-ui, sans-serif"
                  fontWeight="600"
                  fontSize="13"
                  fill={style ? style.hex : MISS_STYLE.hex}
                  aria-hidden="true"
                >
                  {style ? style.word : "Miss"}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <ol
        className={
          size === "small"
            ? "mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted"
            : "mt-3 divide-y divide-line border-t border-line"
        }
        aria-label="Your answers, prompt by prompt"
      >
        {records.map((r) => {
          const style = r.tier ? TIER_STYLE[r.tier] : null;
          if (size === "small") {
            return (
              <li key={r.position} className="tabular-nums">
                {r.position}.{" "}
                {r.pending ? "to play" : style ? `${style.word} ${r.points}` : r.state === "skipped" ? "Skipped" : "Miss"}
              </li>
            );
          }
          return (
            <li key={r.position} className="flex min-h-11 items-center gap-3 py-2 text-sm">
              <span className="w-6 shrink-0 font-mono text-ink-subtle tabular-nums">{r.position}</span>
              {showHeadshots &&
                (r.sleeperId || r.playerName ? (
                  <PlayerHeadshot sleeperId={r.sleeperId ?? null} name="" size={32} />
                ) : (
                  <span className="h-8 w-8 shrink-0 rounded-md border border-dashed border-line-accent" />
                ))}
              {showHeadshots && r.teamCode && <NflTeamLogo team={r.teamCode} size={16} />}
              <span className="min-w-0 flex-1 truncate text-ink">
                {r.pending
                  ? "Not answered yet"
                  : r.state === "timed_out"
                    ? "Time ran out"
                    : r.state === "skipped"
                      ? "Skipped"
                      : (r.playerName ?? "No answer")}
              </span>
              <span className={`shrink-0 font-semibold ${style ? style.text : MISS_STYLE.text}`}>
                {style ? style.word : r.pending ? "" : "Miss"}
              </span>
              <span className="w-16 shrink-0 text-right font-mono font-bold tabular-nums text-ink">
                {r.pending ? "" : r.points}
                {!r.pending && <span className="sr-only"> points</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
