"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Info, TriangleAlert } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { formatEastern } from "@/lib/datetime";
import type { BeamAnswer, BeamMatchedPlayer, BeamPlayerTable } from "@/lib/beam/types";

/**
 * One answer.
 *
 * The visible card and the spoken answer are two renderings of the same content,
 * not two different answers. The card lays facts out as a definition list, which
 * is scannable by eye and useless read aloud in order; the `speech` string flat-
 * tens the same facts into a sentence. Only ONE of them reaches the live region
 * (see beam-chat.tsx), so nothing is announced twice.
 *
 * The card itself is therefore aria-hidden from the live region's point of view
 * but fully reachable by normal reading and by keyboard: links inside it are
 * real links, and a screen reader user browsing the transcript reads the same
 * content again in visual order, which is the correct behaviour for a
 * transcript.
 *
 * A leaderboard answer carries a table instead of facts, rendered by
 * PlayerTable below.
 */

/**
 * A ranked list, ten to a page.
 *
 * Paged in the component rather than by refetching: the whole list arrived with
 * the answer, so a page turn is free and works with no network. The rows are a
 * real <table> because that is what this is, and a screen reader user moving
 * through it by cell gets the rank read with the name rather than as a loose
 * number.
 *
 * PAGE CHANGES ANNOUNCE. Turning a page swaps every row underneath a reader who
 * cannot see it happen, so the live region says which page they are on and how
 * many rows it holds. Focus stays on the button they pressed.
 */
function PlayerTable({ table }: { table: BeamPlayerTable }) {
  const captionId = useId();
  const statusId = useId();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(table.rows.length / table.pageSize));

  // A new answer in the same card resets the pager, so page 3 of a previous
  // list never shows as page 3 of a shorter one.
  useEffect(() => setPage(0), [table]);

  const start = page * table.pageSize;
  const rows = table.rows.slice(start, start + table.pageSize);

  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption id={captionId} className="sr-only">
            {table.caption}. Page {page + 1} of {pageCount}.
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.12em] text-ink-muted">
              <th scope="col" className="w-10 py-2 pr-2 text-right font-semibold">
                #
              </th>
              <th scope="col" className="py-2 font-semibold">
                Player
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.slug} className="border-b border-line/60 last:border-b-0">
                <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-ink-muted">
                  {row.rank}
                </td>
                <td className="py-2">
                  <Link
                    href={`/players/${row.slug}`}
                    className="flex min-h-11 items-center gap-2.5 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    <PlayerHeadshot
                      sleeperId={row.sleeperId}
                      position={row.position ?? undefined}
                      name={row.name}
                      size={32}
                      className="shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{row.name}</span>
                      {(row.position || row.team) && (
                        <span className="block truncate text-xs text-ink-muted">
                          {[row.position, row.team].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-disabled={page === 0}
            aria-controls={captionId}
            className="inline-flex min-h-11 items-center gap-1 rounded-card border border-line px-3 text-sm font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-40"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            Previous
          </button>
          <p className="text-xs text-ink-muted" aria-hidden="true">
            {start + 1} to {start + rows.length} of {table.rows.length}
          </p>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            aria-disabled={page >= pageCount - 1}
            aria-controls={captionId}
            className="inline-flex min-h-11 items-center gap-1 rounded-card border border-line px-3 text-sm font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-40"
          >
            Next
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
          <p id={statusId} aria-live="polite" className="sr-only">
            Page {page + 1} of {pageCount}, ranks {start + 1} to {start + rows.length}.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Is this value a sentence rather than a figure?
 *
 * Word count, not character count. "2,167 passing yards" and "6 foot 1, 220
 * pounds" are long-ish strings and still figures; "Drake London takes 58% of the
 * dynasty signal on value and age" is a sentence at a similar length. Counting
 * words separates them, and it keeps the three Breakdown takeaways in one
 * treatment instead of splitting them across two, which looked like a bug.
 */
function isNarrative(value: string): boolean {
  return value.trim().split(/\s+/).length > 7 || value.length > 60;
}

export function BeamAnswerCard({
  answer,
  matchedPlayers,
  onCorrectPlayer,
}: {
  answer: BeamAnswer;
  matchedPlayers: BeamMatchedPlayer[];
  /** Re-opens the name so the reader can pick a different player. */
  onCorrectPlayer?: (matched: BeamMatchedPlayer) => void;
}) {
  // Only worth showing when we INFERRED the player rather than being told. An
  // exact full-name match needs no confirmation; a nickname or a typo fix does.
  const inferred = matchedPlayers.filter((p) => p.tier !== "exact");

  // Split by what the value IS, not by which capability produced it. "2,167
  // passing yards" belongs in a two-column grid; "Amon-Ra St. Brown takes 53% of
  // the dynasty signal on value and age" is a sentence, and a sentence in a
  // half-width right-aligned column is the thing that reads like a broken table.
  const measured = answer.facts.filter((f) => !isNarrative(f.value));
  const narrative = answer.facts.filter((f) => isNarrative(f.value));

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <p className="text-base font-semibold leading-relaxed text-ink sm:text-lg">
        {answer.headline}
      </p>

      {/* Prose, when the answer is prose. Full width, one paragraph per blank
          line, and no label beside it competing for the same row. */}
      {answer.body ? (
        <div className="mt-3 space-y-3">
          {answer.body
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph) => (
              <p
                key={paragraph.slice(0, 48)}
                className="whitespace-pre-line text-sm leading-relaxed text-ink-muted"
              >
                {paragraph}
              </p>
            ))}
        </div>
      ) : null}

      {answer.table ? <PlayerTable table={answer.table} /> : null}

      {/* Measurements: label and value, two per row where they fit. */}
      {measured.length > 0 && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {measured.map((fact) => (
            <div
              key={`${fact.label}-${fact.value}`}
              className="flex flex-col gap-0.5 border-b border-line/60 pb-2 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
            >
              <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
                {fact.label}
              </dt>
              <dd className="text-sm font-medium text-ink sm:text-right">
                {fact.value}
                {fact.hint ? (
                  <span className="block text-xs font-normal text-ink-muted">{fact.hint}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Facts whose value is a sentence rather than a figure, like a
          Breakdown takeaway. Same data, laid out down the page instead of
          across it: a label above and the sentence at full width, which is the
          difference between reading a line and reading a column three words
          wide. */}
      {narrative.length > 0 && (
        <dl className="mt-4 space-y-3">
          {narrative.map((fact) => (
            <div key={`${fact.label}-${fact.value}`}>
              <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
                {fact.label}
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-ink">
                {fact.value}
                {fact.hint ? (
                  <span className="mt-0.5 block text-xs text-ink-muted">{fact.hint}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {answer.caveats.length > 0 && (
        <ul role="list" className="mt-4 space-y-1.5">
          {answer.caveats.map((caveat) => (
            <li key={caveat} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan"
              />
              <span>{caveat}</span>
            </li>
          ))}
        </ul>
      )}

      {inferred.length > 0 && (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-cyan" />
          <span>
            Matched {inferred.map((p) => p.name).join(" and ")} from what you typed.
          </span>
          {onCorrectPlayer && inferred.length === 1 && (
            <button
              type="button"
              onClick={() => onCorrectPlayer(inferred[0])}
              className="min-h-[44px] font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Not who you meant?
            </button>
          )}
        </p>
      )}

      {(answer.context.formatDisplay ||
        answer.context.sourceDisplay ||
        answer.context.asOf ||
        answer.context.note) && (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {[
            answer.context.formatDisplay,
            answer.context.sourceDisplay ? `${answer.context.sourceDisplay} values` : null,
            answer.context.asOf ? `updated ${formatEastern(answer.context.asOf)}` : null,
            answer.context.note,
          ]
            .filter(Boolean)
            .join(" | ")}
        </p>
      )}

      {answer.links.length > 0 && (
        <ul role="list" className="mt-4 flex flex-wrap gap-2">
          {answer.links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-card border border-line bg-base px-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {link.label}
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
