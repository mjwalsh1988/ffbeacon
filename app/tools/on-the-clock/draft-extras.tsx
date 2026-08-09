"use client";

/**
 * Three small surfaces that finish the room.
 *
 * PassedOnPanel   what each of your picks cost you against the board.
 * RecapBox        a plain-text summary sized for the league chat.
 * RoomSummary     a keyboard-triggered spoken summary of the current state.
 *
 * The last one is the one that matters most here. A drafter looking at the board
 * gets "who is up, how long do I have, what should I take" in one glance. Read
 * aloud, that is four panels and a lot of tabbing, at the exact moment there is
 * least time to spare. This puts the same answer one key away.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ClipboardCopy, Volume2 } from "lucide-react";
import type { PassedOn } from "@/lib/on-the-clock/draft-recap";

export function PassedOnPanel({ entries }: { entries: PassedOn[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line bg-surface/40 px-3 py-2 text-sm text-ink-muted">
        At every one of your picks you took the most valuable player on the board. That is rarer
        than it sounds.
      </p>
    );
  }
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="What your picks cost you, scrollable"
      className="overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <table className="w-max min-w-full border-collapse text-sm sm:w-full">
        <caption className="sr-only">
          Your picks where a more valuable player was still available, largest gap first.
        </caption>
        <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Pick
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              You took
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Best on the board
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Gap
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.pickNo} className="border-t border-line/60">
              <th scope="row" className="px-3 py-2 text-left font-normal font-mono tabular-nums text-ink-muted">
                #{e.pickNo}
              </th>
              <td className="px-3 py-2 text-ink">
                {e.tookName}
                <span className="ml-1.5 font-mono text-xs tabular-nums text-ink-subtle">
                  {e.tookValue.toLocaleString()}
                </span>
              </td>
              <td className="px-3 py-2 text-ink">
                {e.bestName}
                <span className="ml-1.5 font-mono text-xs tabular-nums text-ink-subtle">
                  {e.bestValue.toLocaleString()}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-300">
                {e.gap.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecapBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be refused. The textarea below is the fallback,
      // and it is always there, so there is nothing to recover from.
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 py-2 text-sm font-semibold text-ink hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {copied ? (
            <Check aria-hidden="true" className="h-4 w-4 text-emerald-300" />
          ) : (
            <ClipboardCopy aria-hidden="true" className="h-4 w-4" />
          )}
          Copy recap
        </button>
        <p role="status" aria-live="polite" className="text-xs text-ink-muted">
          {copied ? "Recap copied to your clipboard." : ""}
        </p>
      </div>
      <label htmlFor="otc-recap-text" className="sr-only">
        Draft recap text
      </label>
      <textarea
        id="otc-recap-text"
        readOnly
        value={text}
        rows={Math.min(16, text.split("\n").length + 1)}
        className="w-full rounded-card border border-line bg-base p-3 font-mono text-xs text-ink"
      />
    </div>
  );
}

/**
 * Read the room.
 *
 * Shift plus R fills a polite live region with the state of the draft right now.
 * The shortcut is scoped to the document but ignores every text field, so typing
 * an R into the player search never fires it, and the button beside it does the
 * same thing for anyone who would rather not learn a shortcut.
 */
export function RoomSummary({ build }: { build: () => string }) {
  const [text, setText] = useState("");
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.key.toLowerCase() !== "r") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }
      e.preventDefault();
      // Clearing first guarantees the region re-announces even when the text is
      // identical to last time, which it often is two picks in a row.
      setText("");
      window.setTimeout(() => setText(buildRef.current()), 60);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => {
          setText("");
          window.setTimeout(() => setText(buildRef.current()), 60);
        }}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 py-1.5 text-xs font-semibold text-ink-muted hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <Volume2 aria-hidden="true" className="h-3.5 w-3.5" />
        Read the room
      </button>
      <span className="text-[11px] text-ink-subtle">or press Shift and R</span>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {text}
      </p>
    </div>
  );
}
