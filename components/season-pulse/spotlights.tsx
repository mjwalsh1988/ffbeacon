/**
 * The week in the spotlight: four lists of performances, each led by a
 * feature card.
 *
 * FOUR QUESTIONS, FOUR LISTS (lib/season-pulse/week-report.ts): who scored the
 * most, who beat a real projection by the most, who came from nowhere, and who
 * let a lineup down. The first name in each gets a large card because that is
 * the one a reader will repeat to somebody; the rest are compact rows.
 *
 * Every card says the same things in the same order, by eye and by ear: the
 * name, the position and the finish at it that week, the team and opponent,
 * the points, the projection and the gap, and the box score as a sentence.
 *
 * The group headings are h3 under the panel's h2. Names are links, not
 * headings: a week has twenty-four of them and a heading list that long stops
 * being a way to move around the page.
 *
 * Photos and logos are decorative. Nothing visible is aria-hidden.
 *
 * Server component.
 */

import { Flame, Frown, Sparkles, TrendingUp, type LucideIcon } from "lucide-react";
import { positionNoun } from "@/lib/site";
import type { WeekPerformance, WeekSpotlights } from "@/lib/season-pulse/types";
import { DiffChip, PlayerAvatar, PlayerName, PositionBadge, TeamTag, points } from "./bits";

type Tone = "purple" | "cyan" | "success" | "danger";

const TONE: Record<Tone, { text: string; ring: string; glow: string }> = {
  purple: {
    text: "text-brand-purple-light",
    ring: "linear-gradient(135deg, #A855F7 0%, #6D28D9 100%)",
    glow: "rgba(168, 85, 247, 0.35)",
  },
  cyan: {
    text: "text-brand-cyan",
    ring: "linear-gradient(135deg, #22D3EE 0%, #0E7490 100%)",
    glow: "rgba(34, 211, 238, 0.3)",
  },
  success: {
    text: "text-signal-success",
    ring: "linear-gradient(135deg, #10B981 0%, #22D3EE 100%)",
    glow: "rgba(16, 185, 129, 0.3)",
  },
  danger: {
    text: "text-[#F87171]",
    ring: "linear-gradient(135deg, #F87171 0%, #A855F7 100%)",
    glow: "rgba(248, 113, 113, 0.28)",
  },
};

function matchup(p: WeekPerformance): string {
  const team = p.gameTeam ?? p.team;
  if (team && p.opponent) return `${team} against ${p.opponent}`;
  return team ?? "";
}

function Projection({ p, sourceName }: { p: WeekPerformance; sourceName: string }) {
  if (p.projected === null) {
    return <span className="text-xs text-ink-subtle">No {sourceName} projection</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
      <span>
        Projected {points(p.projected)}
        <span className="sr-only"> by {sourceName}</span>
      </span>
      {p.diff !== null && <DiffChip value={p.diff} />}
    </span>
  );
}

function FeatureCard({
  p,
  tone,
  scoringLabel,
  sourceName,
}: {
  p: WeekPerformance;
  tone: Tone;
  scoringLabel: string;
  sourceName: string;
}) {
  const t = TONE[tone];
  return (
    <div className="rounded-2xl p-px" style={{ backgroundImage: t.ring, boxShadow: `0 0 60px -30px ${t.glow}` }}>
      <div
        className="flex h-full gap-3 rounded-[calc(1rem-1px)] p-4"
        style={{ background: "radial-gradient(120% 140% at 0% 0%, #1B1B33 0%, #12121F 45%, #0B0B14 100%)" }}
      >
        <PlayerAvatar position={p.position} sleeperId={p.sleeperId} team={p.gameTeam ?? p.team} size={64} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2">
            <PlayerName slug={p.slug} name={p.name} className="!text-base font-semibold" />
            <PositionBadge position={p.position} rank={p.weekRank} size="sm" when="that week" />
          </p>
          <p className="-mt-1 flex flex-wrap items-center gap-x-2 text-xs">
            <TeamTag team={p.gameTeam ?? p.team} size={14} />
            {p.opponent && <span className="text-ink-subtle">against {p.opponent}</span>}
          </p>
          <p className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-3xl font-bold tabular-nums text-ink">{points(p.points)}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{scoringLabel} points</span>
          </p>
          <p className="mt-1">
            <Projection p={p} sourceName={sourceName} />
          </p>
          <p className="mt-2 text-xs leading-snug text-ink-muted">{p.line}.</p>
        </div>
      </div>
    </div>
  );
}

function CompactRow({ p, sourceName }: { p: WeekPerformance; sourceName: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-1.5">
        <PlayerAvatar position={p.position} sleeperId={p.sleeperId} team={p.gameTeam ?? p.team} size={36} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2">
          <PlayerName slug={p.slug} name={p.name} />
          <PositionBadge position={p.position} rank={p.weekRank} size="sm" when="that week" />
        </p>
        <p className="-mt-1.5 text-xs text-ink-subtle">{matchup(p)}</p>
        <p className="mt-0.5 text-xs leading-snug text-ink-muted">{p.line}.</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-base font-bold tabular-nums text-ink">
          {points(p.points)}
          <span className="sr-only"> points</span>
        </p>
        <p className="mt-0.5">
          <Projection p={p} sourceName={sourceName} />
        </p>
      </div>
    </li>
  );
}

function Group({
  id,
  icon: Icon,
  tone,
  title,
  blurb,
  empty,
  items,
  scoringLabel,
  sourceName,
}: {
  id: string;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  blurb: string;
  empty: string;
  items: WeekPerformance[];
  scoringLabel: string;
  sourceName: string;
}) {
  const [lead, ...rest] = items;
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-2xl border border-line bg-base/40 p-4">
      <h3 id={id} className={`flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] ${TONE[tone].text}`}>
        <Icon aria-hidden="true" className="h-4 w-4" />
        {title}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{blurb}</p>
      {!lead ? (
        <p className="mt-3 rounded-card border border-dashed border-line px-3 py-4 text-sm text-ink-muted">{empty}</p>
      ) : (
        <>
          <div className="mt-3">
            <FeatureCard p={lead} tone={tone} scoringLabel={scoringLabel} sourceName={sourceName} />
          </div>
          {rest.length > 0 && (
            <ol role="list" aria-label={`${title}, the rest`} className="mt-1 divide-y divide-line/60">
              {rest.map((p) => (
                <CompactRow key={p.id} p={p} sourceName={sourceName} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

export function WeekSpotlightGroups({
  spotlights,
  scoringLabel,
  sourceName,
  idPrefix,
  limit,
}: {
  spotlights: WeekSpotlights;
  scoringLabel: string;
  /** The projection engine the "projected" figures come from. */
  sourceName: string;
  idPrefix: string;
  /** How many per list. The hub shows fewer than the week page. */
  limit?: number;
}) {
  const cut = (items: WeekPerformance[]) => (limit ? items.slice(0, limit) : items);
  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      <Group
        id={`${idPrefix}-best`}
        icon={Flame}
        tone="purple"
        title="Went off"
        blurb="The highest scores of the week at quarterback, running back, wide receiver and tight end."
        empty="No scores are in for this week yet."
        items={cut(spotlights.best)}
        scoringLabel={scoringLabel}
        sourceName={sourceName}
      />
      <Group
        id={`${idPrefix}-beats`}
        icon={TrendingUp}
        tone="success"
        title="Beat the projection"
        blurb="The biggest gaps above a projection of 8 points or more."
        empty="Nobody projected for 8 or more beat his number this week."
        items={cut(spotlights.beats)}
        scoringLabel={scoringLabel}
        sourceName={sourceName}
      />
      <Group
        id={`${idPrefix}-surprises`}
        icon={Sparkles}
        tone="cyan"
        title="Nobody saw it coming"
        blurb="12 points or more from a player projected for under 6, or not projected at all."
        empty="No surprise performances this week."
        items={cut(spotlights.surprises)}
        scoringLabel={scoringLabel}
        sourceName={sourceName}
      />
      <Group
        id={`${idPrefix}-letdowns`}
        icon={Frown}
        tone="danger"
        title="Let you down"
        blurb="The biggest misses by players projected for 12 points or more who took the field."
        empty="Nobody projected for 12 or more fell short this week."
        items={cut(spotlights.letdowns)}
        scoringLabel={scoringLabel}
        sourceName={sourceName}
      />
    </div>
  );
}

/** The top scorers at each of the six positions, one short list each. */
export function TopScorersByPosition({
  spotlights,
  sourceName,
  idPrefix,
}: {
  spotlights: WeekSpotlights;
  sourceName: string;
  idPrefix: string;
}) {
  const positions = Object.keys(spotlights.byPosition) as (keyof WeekSpotlights["byPosition"])[];
  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      {positions.map((position) => {
        const items = spotlights.byPosition[position];
        const headingId = `${idPrefix}-${position.toLowerCase()}`;
        return (
          <section key={position} aria-labelledby={headingId} className="min-w-0 rounded-2xl border border-line bg-base/40 p-4">
            <h3 id={headingId} className="text-sm font-semibold capitalize text-ink">
              {positionNoun(position, "plural")}
            </h3>
            {items.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No scores in yet.</p>
            ) : (
              <ol role="list" className="mt-1 divide-y divide-line/60">
                {items.map((p) => (
                  <CompactRow key={p.id} p={p} sourceName={sourceName} />
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
