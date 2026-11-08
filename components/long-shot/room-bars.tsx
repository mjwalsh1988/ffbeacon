/**
 * "The room" as bars (plan 18A.8): up to five most-given correct answers, each
 * with headshot, crest, linked name, a bar at its share of everyone who faced
 * the prompt (min 4 px) in its tier color, and the count and percent as text.
 * The reader's own answer is outlined when it appears; when it is rarer than
 * the five, a sixth row shows it. Correct answers only, and only after the
 * reader's own answer is recorded.
 */

import Link from "next/link";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { PlayerHeadshot } from "@/components/player-headshot";
import { TIER_STYLE } from "@/lib/long-shot/tier-style";
import type { MostGivenDto, Tier } from "@/lib/long-shot/types";

export interface OwnAnswer {
  playerName: string;
  slug: string | null;
  sleeperId: string | null;
  teamCode: string | null;
  tier: Tier;
  count: number;
}

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function Row({ row, total, own }: { row: MostGivenDto | OwnAnswer; total: number; own: boolean }) {
  const style = TIER_STYLE[row.tier];
  const share = total > 0 ? row.count / total : 0;
  return (
    <li className={`rounded-card px-2 py-2 ${own ? "outline outline-1 outline-ink" : ""}`}>
      <div className="flex min-h-11 items-center gap-3">
        <PlayerHeadshot sleeperId={row.sleeperId} name="" size={32} />
        {row.teamCode && <NflTeamLogo team={row.teamCode} size={16} />}
        <span className="min-w-0 flex-1 truncate text-sm">
          {row.slug ? (
            <Link
              href={`/players/${row.slug}`}
              className="inline-flex min-h-11 items-center font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
            >
              {row.playerName}
            </Link>
          ) : (
            <span className="font-semibold text-ink">{row.playerName}</span>
          )}
          <span className={`ml-2 text-xs font-semibold ${style.text}`}>{style.word}</span>
          {own && <span className="ml-2 text-xs text-ink-muted">Your answer</span>}
        </span>
        <span className="shrink-0 text-right font-mono text-sm font-bold tabular-nums text-ink">
          {row.count}, {pct(row.count, total)}%
          <span className="sr-only"> of {total} players</span>
        </span>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-line" aria-hidden="true">
        <div
          className="h-2 rounded-full"
          style={{
            width: `max(4px, ${(share * 100).toFixed(1)}%)`,
            background: row.tier === "long_shot" ? "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" : style.hex,
          }}
        />
      </div>
    </li>
  );
}

export function RoomBars({
  mostGiven,
  total,
  own,
  ownPlayerSlug,
}: {
  mostGiven: MostGivenDto[];
  total: number;
  own: OwnAnswer | null;
  ownPlayerSlug: string | null;
}) {
  if (mostGiven.length === 0 && !own) return null;
  const ownInList = own ? mostGiven.some((m) => m.slug !== null && m.slug === ownPlayerSlug) : false;
  return (
    <ul className="space-y-1" aria-label="Most given correct answers">
      {mostGiven.map((m) => (
        <Row key={`${m.slug ?? m.playerName}`} row={m} total={total} own={ownInList && m.slug === ownPlayerSlug} />
      ))}
      {own && !ownInList && <Row row={own} total={total} own />}
    </ul>
  );
}
