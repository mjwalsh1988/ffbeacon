/**
 * week_awards: the week in numbers (plan section 23.3).
 *
 * One tile per row of the dataset: a label, the value as ONE text node, and
 * the detail sentence. A player tile carries his photo (decorative; his name
 * is the value text) and links to his profile; a game tile links down to that
 * game's card. Nothing is formatted here: every string is the dataset's.
 *
 * Server component.
 */

import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import type { BundleDataset } from "@/lib/brief-desk/types";
import { BlockShell } from "./block-shell";
import { gameAnchor, teamNickname } from "./game-cards";

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
}

const LINK_CLASS =
  "mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-ink-subtle transition-colors hover:text-brand-cyan focus-visible:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export function WeekAwardsBlock({
  id,
  caption,
  conclusion,
  dataset,
  games,
}: {
  id: string;
  caption: string;
  conclusion: string;
  dataset: BundleDataset;
  /** The week_games dataset when the edition carries the cards; game tiles link down only then. */
  games: BundleDataset | null;
}) {
  const tiles = dataset.rows.filter((r) => text(r.label) && text(r.value));
  // The bench figures are about managers, not players, so they sit together
  // in their own row of three rather than leaving a lone tile half a row wide.
  const main = tiles.filter((t) => !String(t.id).startsWith("bench_"));
  const bench = tiles.filter((t) => String(t.id).startsWith("bench_"));
  // "Falcons at Packers" for the link, read as words rather than spelled codes.
  const gameNames = new Map(
    (games?.rows ?? []).map((g) => [
      String(g.game_key),
      `${teamNickname(text(g.away_name) ?? String(g.away))} at ${teamNickname(text(g.home_name) ?? String(g.home))}`,
    ]),
  );
  return (
    <BlockShell id={id} caption={caption} conclusion={conclusion} dataset={dataset}>
      {tiles.length === 0 ? (
        <p className="text-sm text-ink-muted">No figures were recorded for this week.</p>
      ) : (
        <>
          <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {main.map((t) => (
              <Tile key={String(t.id)} t={t} gameNames={gameNames} />
            ))}
          </ul>
          {bench.length > 0 && (
            <div className="mt-4 rounded-2xl border border-brand-purple/40 bg-brand-purple/[0.07] p-3 sm:p-4">
              <p id={`block-${id}-bench`} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple-light">
                From leagues synced to FF Beacon
              </p>
              {/* The two figures in display size; the costliest call is a
                  sentence, so it is set smaller and, until lg, takes the full
                  row instead of squeezing three labels into a 768px card. */}
              <ul role="list" aria-labelledby={`block-${id}-bench`} className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {bench.map((t) => {
                  const figure = /^[\d.,]+$/.test(text(t.value) ?? "");
                  return (
                  <li key={String(t.id)} className={`min-w-0 ${figure ? "" : "sm:col-span-2 lg:col-span-1"}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">{text(t.label)}</p>
                    <p className={figure ? "mt-1 font-mono text-3xl font-bold tabular-nums text-ink" : "mt-1 text-lg font-bold leading-snug text-ink"}>{text(t.value)}</p>
                    {text(t.detail) && <p className="mt-1 text-xs leading-snug text-ink-muted">{text(t.detail)}</p>}
                  </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </BlockShell>
  );
}

type Row = BundleDataset["rows"][number];

function Tile({ t, gameNames }: { t: Row; gameNames: Map<string, string> }) {
  const slug = text(t.slug);
  const game = text(t.game_key);
  return (
    <li className="flex gap-3 rounded-2xl border border-line bg-surface/60 p-3 sm:p-4">
      {text(t.player_id) ? (
        <PlayerHeadshot sleeperId={text(t.sleeper_id)} name="" size={56} className="shrink-0" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-line bg-base/60">
          <Trophy aria-hidden="true" className="h-6 w-6 text-brand-cyan" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">{text(t.label)}</p>
        <p className="mt-1 text-base font-semibold leading-snug text-ink">{text(t.value)}</p>
        {text(t.detail) && <p className="mt-1 text-xs leading-snug text-ink-muted">{text(t.detail)}</p>}
        {slug && (
          <Link href={`/players/${slug}`} className={LINK_CLASS}>
            Player profile<span className="sr-only">{`: ${text(t.name) ?? ""}`}</span>
            <ArrowRight aria-hidden="true" className="h-3 w-3" />
          </Link>
        )}
        {!slug && game && gameNames.has(game) && (
          <a href={`#${gameAnchor(game)}`} className={LINK_CLASS}>
            {`${gameNames.get(game)} card`}
            <ArrowRight aria-hidden="true" className="h-3 w-3" />
          </a>
        )}
      </div>
    </li>
  );
}
