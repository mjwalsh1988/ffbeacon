/**
 * The waiver wire between seasons: last season's best pickups.
 *
 * WHY THIS EXISTS. From the end of week 18 until the new season's projections
 * land there is no wire to rank, and the board used to fall through to an
 * empty card about projections that had not landed, under a "Week 19" chip.
 * This replaces the board with something worth reading in the meantime: which
 * players our leagues actually picked up last season, off waivers or as free
 * agents, and what each one paid back afterwards. The data and its rules
 * (points from the week most leagues picked him up, through week 17, and a
 * floor on how many leagues must have done it) are in
 * lib/waiver-wire/offseason-build.ts.
 *
 * ONE SHEET, NOT A STACK OF PANELS. Drawn on the Team Blueprint's report
 * sheet (components/league-blueprint/sheet.tsx): a letterhead with the season
 * summary as a form with dotted leaders, then numbered sections divided by
 * full-width rules. Inside a section nothing is boxed. The best pickup at
 * each position is four ruled columns, each topped with its position color,
 * because quarterbacks outscore everyone and a single list would be a list of
 * quarterbacks. The full list is a real table behind the same position tabs
 * the in-season board uses, so every figure sits under a visible column
 * label rather than floating beside a name.
 *
 * FORMAT, NOT SOURCE. Points are scored under the reader's format (PPR, half
 * PPR or standard, plus a tight end premium when the format has one), so the
 * order changes with the header toggle as the source and format sync rule
 * requires. No value source is involved, so the source toggle changes nothing.
 *
 * NOTHING VISIBLE IS aria-hidden except decoration: the headshots beside a
 * visible name and the bars beside the figures they draw.
 *
 * Presentational server component; the tabs are the one client island.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { Bar, Leader, RULED, Sheet, SheetSection } from "@/components/league-blueprint/sheet";
import { positionNounMap } from "@/lib/site";
import {
  FANTASY_LAST_WEEK,
  SHOWCASE_POSITIONS,
  pickupCost,
  rankShowcase,
  type ShowcasePosition,
  type ShowcaseScoring,
} from "@/lib/waiver-wire/offseason-build";
import type { PickupShowcase, ShowcasePlayer } from "@/lib/waiver-wire/offseason";
import { BoardTabs, type BoardTab } from "./board-tabs";
import { POSITION_HEX } from "./player-card";

const POSITION_WORD = positionNounMap(SHOWCASE_POSITIONS);
const POSITION_PLURAL = positionNounMap(SHOWCASE_POSITIONS, { form: "plural" });

/** Rows per tab. */
const MAX_ROWS = 15;

const NAME_LINK =
  "inline-flex min-h-11 items-center underline-offset-4 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export type OffseasonScoring = {
  scoring: ShowcaseScoring;
  tePremiumBonus: number;
  /** e.g. "Redraft PPR", the resolved format's display name. */
  formatName: string;
};

type Ranked = ShowcasePlayer & { scored: number; share: number };

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function scoringWords(s: OffseasonScoring): string {
  const base = s.scoring === "standard" ? "standard" : s.scoring === "half_ppr" ? "half-PPR" : "PPR";
  return s.tePremiumBonus > 0 ? `${base} points with the tight end premium` : `${base} points`;
}

function one(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function pct(n: number): string {
  if (n > 0 && n < 1) return `${one(n)}%`;
  return `${Math.round(n)}%`;
}

function games(n: number): string {
  return `${n} ${n === 1 ? "game" : "games"}`;
}

/** The cost, in words a row can carry. */
function costText(p: ShowcasePlayer): string {
  const c = pickupCost(p);
  if (c.kind === "bid" && c.pct !== null) {
    return `${pct(c.pct)} median bid, ${c.samples} ${c.samples === 1 ? "claim" : "claims"}`;
  }
  if (c.kind === "free") return "Mostly free agent adds";
  return "Too few priced claims";
}

/* ---------- 01: the best pickup at each position ---------- */

function LeaderColumn({ player, leagues }: { player: Ranked; leagues: number }) {
  const hue = POSITION_HEX[player.position];
  const perGame = player.points.games > 0 ? player.scored / player.points.games : 0;
  return (
    <li className="min-w-0 border-t-2 pt-4" style={{ borderTopColor: hue }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: hue }}>
        {capitalize(POSITION_WORD[player.position])}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <span aria-hidden="true" className="shrink-0 overflow-hidden rounded-full border border-line bg-base">
          <PlayerHeadshot sleeperId={player.sleeperId} name="" size={44} />
        </span>
        <h3 className="min-w-0 text-base font-bold leading-tight tracking-tight text-ink">
          <Link href={`/players/${player.slug}`} className={NAME_LINK}>
            {player.name}
          </Link>
        </h3>
      </div>
      <p className="mt-3 font-mono text-4xl font-black leading-none tabular-nums text-ink">
        {one(player.scored)}
        <span className="mt-1.5 block font-sans text-xs font-semibold text-ink-subtle">
          points after the pickup
        </span>
      </p>
      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-ink-subtle">
        From week {player.typicalWeek}, {games(player.points.games)}, {one(perGame)} a game
      </p>
      <dl className="mt-3">
        <Leader label="Cost">
          <span className="text-brand-cyan">{costText(player)}</span>
        </Leader>
        <Leader label="Leagues">
          <span className="font-mono tabular-nums">
            {player.leagues} of {leagues}
          </span>
        </Leader>
      </dl>
      {/* The share of leagues, drawn under the Leagues line. After the dl, not
          inside it: a dl may hold nothing but its dt and dd groups. */}
      <Bar fraction={player.share} />
    </li>
  );
}

/* ---------- 02: the ranked table ---------- */

function PickupTable({ rows, leagues, caption }: { rows: Ranked[]; leagues: number; caption: string }) {
  const shown = rows.slice(0, MAX_ROWS);
  const top = shown[0]?.scored ?? 0;
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col className="w-12" />
        <col />
        <col className="w-[5.5rem] sm:w-36" />
        <col className="w-[6.75rem] sm:w-48" />
      </colgroup>
      <thead>
        <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
          <th scope="col" className="py-2 pr-2 font-semibold">
            Rank
          </th>
          <th scope="col" className="py-2 pr-2 font-semibold">
            Player
          </th>
          <th scope="col" className="py-2 pr-2 text-right font-semibold">
            Points
          </th>
          <th scope="col" className="py-2 text-right font-semibold">
            Leagues and cost
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/70">
        {shown.map((p, i) => {
          const hue = POSITION_HEX[p.position];
          const perGame = p.points.games > 0 ? p.scored / p.points.games : 0;
          return (
            <tr key={p.playerId} className="align-top">
              <td className="py-3 pr-2 font-mono text-sm font-black tabular-nums" style={{ color: hue }}>
                {i + 1}
              </td>
              <th scope="row" className="min-w-0 py-1.5 pr-2 font-normal">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="hidden shrink-0 overflow-hidden rounded-full border border-line bg-base sm:block"
                  >
                    <PlayerHeadshot sleeperId={p.sleeperId} name="" size={32} />
                  </span>
                  <span className="min-w-0">
                    <Link
                      href={`/players/${p.slug}`}
                      className={`${NAME_LINK} break-words text-sm font-semibold text-ink`}
                    >
                      {p.name}
                    </Link>
                    <span className="block text-[11px] leading-snug text-ink-subtle">
                      <span className="font-mono font-bold" style={{ color: hue }}>
                        {p.position}
                      </span>
                      <span className="sr-only"> ({POSITION_WORD[p.position]})</span>, picked up week{" "}
                      {p.typicalWeek}
                    </span>
                  </span>
                </span>
              </th>
              <td className="py-3 pr-2 text-right">
                <span className="block font-mono text-base font-extrabold tabular-nums text-ink">
                  {one(p.scored)}
                </span>
                <span className="block font-mono text-[11px] tabular-nums text-ink-subtle">
                  {one(perGame)} a game, {games(p.points.games)}
                </span>
                <Bar fraction={top > 0 ? p.scored / top : 0} className="mt-1.5" />
              </td>
              <td className="py-3 text-right">
                <span className="block font-mono text-sm font-semibold tabular-nums text-ink">
                  {p.leagues} of {leagues}
                </span>
                <span className="block text-[11px] text-ink-subtle">{pct(p.share * 100)} of leagues</span>
                <span className="block text-[11px] text-brand-cyan">{costText(p)}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------- The dynasty note ---------- */

function DynastySection({ number }: { number: string }) {
  return (
    <SheetSection
      id="offseason-dynasty"
      number={number}
      title="Still bidding?"
      helper="Dynasty waivers do not stop for the offseason."
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-sm leading-relaxed text-ink-muted">
          Dynasty leagues run waivers all spring, for rookies and undrafted free agents. The FAAB
          calculator prices those claims against your own roster and budget.
        </p>
        <Link
          href="/tools/faab"
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-[#07070D] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
        >
          Open the FAAB calculator
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </SheetSection>
  );
}

/** The letterhead: the report's name on the left, its details as a form on the right. */
function Letterhead({
  title,
  body,
  details,
}: {
  title: string;
  body: string;
  details: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <header className="grid gap-6 px-5 pb-6 pt-7 sm:px-8 sm:pb-8 sm:pt-9 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-10">
      <div className="min-w-0">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-cyan">
          Offseason report
        </p>
        <h2 id="offseason-heading" className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          {title}
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-muted sm:text-[15px]">{body}</p>
      </div>
      <dl className="self-start border-t border-line pt-3 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        {details.map((d) => (
          <Leader key={d.label} label={d.label}>
            {d.value}
          </Leader>
        ))}
      </dl>
    </header>
  );
}

/* ---------- The board ---------- */

export function OffseasonBoard({
  showcase,
  season,
  scoring,
  initialPosition,
}: {
  showcase: PickupShowcase | null;
  /** The season that just finished. */
  season: number;
  scoring: OffseasonScoring;
  initialPosition: string | null;
}) {
  if (!showcase || showcase.players.length === 0) {
    return (
      <Sheet labelledBy="offseason-heading">
        <Letterhead
          title={`The waiver wire is closed until ${season + 1}`}
          body={`The ${season} regular season is over, and the look back at its best pickups is still being put together from our leagues. It appears here within a day.`}
          details={[
            { label: "Season", value: `${season}, finished` },
            { label: "Weekly board", value: `Returns with the ${season + 1} projections` },
          ]}
        />
        <DynastySection number="01" />
      </Sheet>
    );
  }

  const leagues = showcase.leagues;
  const ranked: Ranked[] = rankShowcase(showcase.players, scoring.scoring, scoring.tePremiumBonus, leagues);
  const leaders = SHOWCASE_POSITIONS.map((pos) => ranked.find((p) => p.position === pos)).filter(
    (p): p is Ranked => !!p,
  );
  const mostAdded = [...ranked].sort((a, b) => b.leagues - a.leagues)[0];
  // The biggest return on the smallest outlay: the top scorer among pickups
  // that cleared at 1% of a budget or less, or went mostly to free agents.
  const bargain = ranked.find((p) => {
    const c = pickupCost(p);
    return c.kind === "free" || (c.kind === "bid" && c.pct !== null && c.pct <= 1);
  });

  const details: Array<{ label: string; value: ReactNode }> = [
    { label: "Leagues measured", value: <span className="font-mono tabular-nums">{leagues}</span> },
  ];
  if (mostAdded) {
    details.push({
      label: "Most picked up",
      value: `${mostAdded.name}, ${pct(mostAdded.share * 100)} of leagues`,
    });
  }
  if (bargain) {
    const c = pickupCost(bargain);
    details.push({
      label: "Biggest bargain",
      value: `${bargain.name}, ${one(bargain.scored)} points for ${
        c.kind === "free" ? "a free agent add" : `a ${pct(c.pct ?? 0)} bid`
      }`,
    });
  }
  details.push({ label: "Scoring", value: scoring.formatName });
  details.push({ label: "Weekly board", value: `Returns with the ${season + 1} projections` });

  const tabs: BoardTab[] = [
    {
      key: "ALL",
      short: "All",
      label: "All positions",
      count: Math.min(MAX_ROWS, ranked.length),
      hue: "#22D3EE",
      content: (
        <PickupTable
          rows={ranked}
          leagues={leagues}
          caption={`The best ${season} waiver wire pickups at every position, ranked by ${scoringWords(scoring)} after the pickup`}
        />
      ),
    },
    ...SHOWCASE_POSITIONS.map((pos: ShowcasePosition) => {
      const rows = ranked.filter((p) => p.position === pos);
      return {
        key: pos,
        short: pos,
        label: capitalize(POSITION_PLURAL[pos]),
        count: Math.min(MAX_ROWS, rows.length),
        hue: POSITION_HEX[pos],
        content: (
          <PickupTable
            rows={rows}
            leagues={leagues}
            caption={`The best ${season} ${POSITION_WORD[pos]} pickups, ranked by ${scoringWords(scoring)} after the pickup`}
          />
        ),
      };
    }).filter((t) => t.count > 0),
  ];
  const initialKey =
    initialPosition && tabs.some((t) => t.key === initialPosition) ? initialPosition : "ALL";

  return (
    <Sheet labelledBy="offseason-heading">
      <Letterhead
        title={`The best waiver wire pickups of ${season}`}
        body={`The wire is closed until the ${season + 1} season, so here is what it paid out. These are the players the ${leagues} leagues synced to FF Beacon picked up most, off waivers or as free agents, ranked by the ${scoringWords(scoring)} they scored after the pickup.`}
        details={details}
      />

      <SheetSection
        id="offseason-leaders"
        number="01"
        title="Best at each position"
        helper="The top scorer after the pickup at each position."
      >
        <ol role="list" className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
          {leaders.map((p) => (
            <LeaderColumn key={p.playerId} player={p} leagues={leagues} />
          ))}
        </ol>
      </SheetSection>

      <SheetSection
        id="offseason-list"
        number="02"
        title="Every pickup that paid off"
        helper={`Ranked by ${scoringWords(scoring)} from the week most leagues picked him up through week ${FANTASY_LAST_WEEK}.`}
      >
        <BoardTabs
          tabs={tabs}
          initialKey={initialKey}
          label={`The best ${season} waiver wire pickups by position`}
          countLabel="pickups listed"
        />
      </SheetSection>

      <SheetSection id="offseason-method" number="03" title="How it is measured">
        <ul role="list" className={`${RULED} text-sm leading-relaxed text-ink-muted`}>
          <li className="py-3">
            <span className="font-semibold text-ink">Who is listed. </span>A player at least 5 percent
            of the season&apos;s leagues picked up, off waivers or as a free agent.
          </li>
          <li className="py-3">
            <span className="font-semibold text-ink">The points. </span>From the week most of those
            leagues first picked him up through week {FANTASY_LAST_WEEK}, where most fantasy seasons
            end, under {scoring.formatName} scoring.
          </li>
          <li className="py-3">
            <span className="font-semibold text-ink">The cost. </span>The median winning FAAB bid as a
            share of the season budget, with the number of priced claims behind it.
          </li>
          <li className="py-3">
            <span className="font-semibold text-ink">The leagues. </span>Readers connected them
            themselves, so they lean dynasty and are not a sample of Sleeper as a whole.
          </li>
        </ul>
      </SheetSection>

      <DynastySection number="04" />
    </Sheet>
  );
}
