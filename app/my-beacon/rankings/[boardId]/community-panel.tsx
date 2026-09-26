"use client";

import { useId, useState, useTransition } from "react";
import { Users } from "lucide-react";
import { saveBoardMeta } from "../actions";

/**
 * The board's community settings (plan section 9.1): a QUIET side control, not
 * a prompt. On by default. Says in plain words whether this board counts
 * toward the community rankings, how many more players would make it count,
 * and, for a board made before boards remembered a format, asks once which
 * format it is for.
 *
 * No individual board is ever shown on the community page; this board would
 * contribute to an aggregate only.
 */
export function CommunityPanel({
  boardId,
  initialOptOut,
  playerCount,
  minPlayers,
  hasFormat,
  formats,
}: {
  boardId: string;
  initialOptOut: boolean;
  playerCount: number;
  /** 50 for a multi-position board, 12 for one position (settings). */
  minPlayers: number;
  hasFormat: boolean;
  formats: { slug: string; displayName: string }[];
}) {
  const switchId = useId();
  const hintId = useId();
  const formatId = useId();
  const [optOut, setOptOut] = useState(initialOptOut);
  const [formatSaved, setFormatSaved] = useState(hasFormat);
  const [formatSlug, setFormatSlug] = useState("");
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !optOut;
    setOptOut(next);
    startTransition(async () => {
      const r = await saveBoardMeta(boardId, { communityOptOut: next });
      if (!r.ok) {
        setOptOut(!next);
        setStatus(r.error);
      } else {
        setStatus(next ? "This board is left out of the community rankings." : "This board is included in the community rankings.");
      }
    });
  };

  const saveFormat = () => {
    if (!formatSlug) return;
    startTransition(async () => {
      const r = await saveBoardMeta(boardId, { formatSlug });
      if (r.ok) {
        setFormatSaved(true);
        setStatus("Format saved.");
      } else {
        setStatus(r.error);
      }
    });
  };

  const short = Math.max(0, minPlayers - playerCount);
  let eligibility: string;
  if (optOut) eligibility = "Left out of the community rankings.";
  else if (!formatSaved) eligibility = "Needs a format before it can count.";
  else if (short > 0) {
    eligibility = `${short} more player${short === 1 ? "" : "s"} and this board counts toward the community rankings.`;
  } else eligibility = "Counts toward the community rankings in its format.";

  return (
    <aside aria-label="Community rankings" className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <Users aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              id={switchId}
              type="button"
              role="switch"
              aria-checked={!optOut}
              aria-describedby={hintId}
              disabled={pending}
              onClick={toggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                !optOut ? "border-brand-purple bg-brand-purple/30" : "border-line bg-base"
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-4 w-4 transform rounded-full bg-ink transition-transform ${
                  !optOut ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <label htmlFor={switchId} className="text-sm font-medium text-ink">
              Include in community rankings
            </label>
          </div>
          <p id={hintId} className="text-xs text-ink-muted">
            {eligibility} Boards are merged anonymously; no single board is ever shown.
          </p>
          {!formatSaved && !optOut && (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor={formatId} className="block text-xs font-medium text-ink">
                  Which format is this board for?
                </label>
                <select
                  id={formatId}
                  value={formatSlug}
                  onChange={(e) => setFormatSlug(e.target.value)}
                  className="mt-1 min-h-11 rounded-card border border-line bg-base px-3 text-base text-ink focus:border-brand-purple focus:outline-none sm:text-sm"
                >
                  <option value="">Choose a format</option>
                  {formats.map((f) => (
                    <option key={f.slug} value={f.slug}>
                      {f.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={saveFormat}
                disabled={!formatSlug || pending}
                className="inline-flex min-h-11 items-center rounded-card border border-line px-3 text-sm font-medium text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
              >
                Save format
              </button>
            </div>
          )}
          <p role="status" className="text-xs text-ink-subtle">
            {status}
          </p>
        </div>
      </div>
    </aside>
  );
}
