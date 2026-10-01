/**
 * One player's week as a compact row, shared by every stat block in an
 * edition (top scorers, the cited players' lines, the game cards): the photo,
 * the name on one line with the team and opponent beside it, the whole stat
 * line as one sentence under it, and the fantasy points large on the right
 * with the secondary figures under them.
 *
 * It replaced 17-column tables whose names wrapped onto two lines and which
 * scrolled sideways on every screen. No figure is dropped: the sentence
 * carries every stat column the row has (lib/brief-desk/dataset-read.ts
 * rowLineText), and the right-hand column carries the scoring figures, so the
 * same data reads in the same order at every width.
 *
 * Read aloud, a row is: rank, name, team and opponent, the sentence, then the
 * points with their label. Nothing visible is aria-hidden except the photo,
 * which is decorative because the name is the adjacent text.
 *
 * No hooks, so it renders inside server and client blocks alike.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { BLOCK_LINK_CLASS } from "./block-shell";

export function PlayerLineRow({
  rank,
  name,
  slug,
  sleeperId,
  meta,
  line,
  figure,
  figureLabel,
  sub,
  aside,
}: {
  rank?: number | null;
  name: string;
  slug: string | null;
  sleeperId: string | null;
  /** "QB, SF vs ARI": short context after the name. */
  meta?: string | null;
  /** The stat line as one sentence; omitted when empty. */
  line?: string | null;
  /** The headline figure, already formatted ("31.3"). */
  figure: string;
  /** The word after it, visible ("PPR"). */
  figureLabel: string;
  /** Secondary figures under the headline one. */
  sub?: ReactNode;
  /** Anything extra on the right, such as a beat or miss badge. */
  aside?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      {typeof rank === "number" && (
        <span className="mt-2 w-5 shrink-0 text-right font-mono text-xs tabular-nums text-ink-subtle">{rank}</span>
      )}
      <PlayerHeadshot sleeperId={sleeperId} name="" size={40} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {slug ? (
            <Link href={`/players/${slug}`} className={`-my-3 inline-flex min-h-11 items-center break-words text-sm ${BLOCK_LINK_CLASS}`}>
              {name}
            </Link>
          ) : (
            <span className="break-words text-sm font-medium text-ink">{name}</span>
          )}
          {meta && <span className="text-xs text-ink-subtle">{meta}</span>}
        </p>
        {line && <p className="mt-0.5 text-xs leading-snug text-ink-muted">{line}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-base font-bold tabular-nums text-ink">
          {figure}{" "}
          {/* A real space, so the text reads "35.3 PPR" rather than "35.3PPR". */}
          <span className="font-sans text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{figureLabel}</span>
        </p>
        {sub && <div className="mt-0.5 text-[11px] leading-tight text-ink-subtle">{sub}</div>}
        {aside}
      </div>
    </li>
  );
}

/** "QB, SF vs ARI" from whichever parts exist. */
export function rowMeta(position: string | null, team: string | null, opponent: string | null): string | null {
  const who = [position, team].filter(Boolean).join(", ");
  const vs = opponent ? `vs ${opponent.replace(/^@/, "")}` : "";
  const out = [who, vs].filter(Boolean).join(" ");
  return out || null;
}
