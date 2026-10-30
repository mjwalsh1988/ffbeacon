/**
 * The trade activity gauge (plan 9.10). The arc is drawn from
 * lib/league-blueprint/gauge-geometry.ts and is decoration: the element is
 * role="img" named with the band and the score, and the band word beside it
 * is the section's hero figure as real text.
 */

import { gaugeGeometry } from "@/lib/league-blueprint/gauge-geometry";
import type { BlueprintActivity } from "@/lib/league-blueprint/types";
import { HERO_LABEL, HERO_SUB } from "./bits";

const WIDTH = 220;
const STROKE = 16;

export function Gauge({ activity, bands }: { activity: BlueprintActivity; bands: [number, number] }) {
  const g = gaugeGeometry(activity.score, { width: WIDTH, stroke: STROKE, bands });
  return (
    <div className="flex flex-wrap items-end gap-5">
      <div
        role="img"
        aria-label={`Recommended trade activity: ${activity.band}, ${activity.score} of 100`}
        className="shrink-0"
      >
        <svg width={WIDTH} height={g.height} viewBox={`0 0 ${WIDTH} ${g.height}`} aria-hidden="true" className="pointer-events-none block max-w-full">
          <defs>
            <linearGradient id="bp-gauge-fill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#A855F7" />
              <stop offset="1" stopColor="#22D3EE" />
            </linearGradient>
          </defs>
          <path d={g.track} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={STROKE} strokeLinecap="round" />
          {g.fill && (
            <path d={g.fill} fill="none" stroke="url(#bp-gauge-fill)" strokeWidth={STROKE} strokeLinecap="round" />
          )}
          {g.ticks.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
          ))}
        </svg>
      </div>
      <div className="min-w-0 pb-1">
        <p className={HERO_LABEL}>Trade activity</p>
        <p className="mt-1 bg-beacon bg-clip-text font-mono text-3xl font-black leading-none text-transparent sm:text-4xl">
          {activity.band}
        </p>
        <p className={`mt-1 ${HERO_SUB}`}>{activity.score} of 100</p>
      </div>
    </div>
  );
}
