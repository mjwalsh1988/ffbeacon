/**
 * One leaderboard row (plan 18A.10): rank in a fixed 44 px column, avatar,
 * name (linked to the Signal profile only when it is live), and the figure
 * right-aligned. The reader's own row carries a cyan "You" chip and a cyan
 * left border. Every column stays at every width; the second figure drops
 * under the name below sm rather than disappearing.
 */

import Link from "next/link";
import { ImageWithFallback } from "@/components/image-with-fallback";
import type { BoardRow as Row } from "@/lib/long-shot/leaderboards";

export function BoardName({ row }: { row: Pick<Row, "name" | "profileHref"> }) {
  return row.profileHref ? (
    <Link
      href={row.profileHref}
      aria-label={`${row.name}, open Signal profile`}
      className="inline-flex min-h-11 min-w-11 items-center font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
    >
      {row.name}
    </Link>
  ) : (
    <span className="font-semibold text-ink">{row.name}</span>
  );
}

export function BoardAvatar({ url, size }: { url: string | null; size: number }) {
  return <ImageWithFallback src={url} alt="" size={size} className="shrink-0" />;
}

export function BoardRowItem({
  row,
  figureUnit,
  secondaryLabel,
}: {
  row: Row;
  figureUnit: string;
  secondaryLabel: string | null;
}) {
  return (
    <li className={`flex items-center gap-3 border-b border-line py-2 pl-2 pr-1 ${row.isYou ? "border-l-2 border-l-brand-cyan" : ""}`}>
      <span className="w-11 shrink-0 text-xl font-black tabular-nums text-ink-muted">
        {row.rank}
        <span className="sr-only">. </span>
      </span>
      <BoardAvatar url={row.avatarUrl} size={32} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <BoardName row={row} />
          {row.isYou && (
            <span className="rounded-full border border-brand-cyan px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-cyan">
              You
            </span>
          )}
        </span>
        {secondaryLabel && (
          <span className="block text-xs text-ink-subtle">
            {secondaryLabel}: {row.secondary}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right font-mono font-bold tabular-nums text-ink">
        {row.figure}
        <span className="sr-only"> {figureUnit}</span>
      </span>
    </li>
  );
}
