"use client";

/**
 * The saved drafts, and the one place a draft can be deleted.
 *
 * A client component only because deleting needs somewhere to say so and
 * somewhere to put focus. Every string it renders was formatted on the server,
 * including the timestamp, which keeps the Eastern-time rule where it belongs
 * and keeps a date formatter out of the browser bundle.
 */

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { DeleteTrackerButton } from "./delete-tracker-button";

/** One card, already put into words by the server. */
export type SavedDraftRow = {
  id: string;
  name: string;
  formatLabel: string;
  /** "12 teams, you are Sarah" or "Your team only". */
  teamsLine: string;
  /** "48 off the board, 6 on your team." */
  countsLine: string;
  /** Already through formatEastern. */
  lastTouched: string;
  isComplete: boolean;
};

const PANEL_ID = "saved-drafts";

export function SavedDraftsList({ drafts }: { drafts: SavedDraftRow[] }) {
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLElement | null>(null);

  const handleDeleted = useCallback(
    (name: string) => {
      const left = drafts.length - 1;
      setAnnouncement(
        `Deleted the draft ${name}. ${left} saved ${left === 1 ? "draft" : "drafts"} left.`,
      );
      // The row that held focus is about to stop existing, so hand focus to the
      // heading of the list it was in rather than letting it fall to the body.
      headingRef.current =
        (document.getElementById(`${PANEL_ID}-title`) as HTMLElement | null) ?? null;
      headingRef.current?.focus();
    },
    [drafts.length],
  );

  return (
    <Panel
      id={PANEL_ID}
      eyebrow="Saved drafts"
      title={
        drafts.length === 0
          ? "No drafts saved yet."
          : `${drafts.length} saved draft${drafts.length === 1 ? "" : "s"}`
      }
      helper={
        drafts.length === 0
          ? undefined
          : "Open one to keep going, or to look back at what everyone took."
      }
      headingLevel={2}
      headingFocusable
    >
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {drafts.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          Use{" "}
          <Link
            href="/my-beacon/draft-tracker/new"
            className="font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Set up a draft
          </Link>{" "}
          above to make one. Every draft saves as you go and keeps the name you
          give it, so you can close the page mid draft and pick it back up here
          on any device.
        </p>
      ) : (
        <ul className="grid gap-3">
          {drafts.map((draft) => (
            <li key={draft.id} className="rounded-card border border-line bg-base/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-ink">
                    {draft.name}
                    {draft.isComplete && (
                      <span className="ml-2 rounded-card border border-line bg-surface px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        Finished
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {draft.formatLabel}. {draft.teamsLine}.
                  </p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {draft.countsLine} Last touched {draft.lastTouched}.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <DeleteTrackerButton
                    trackerId={draft.id}
                    trackerName={draft.name}
                    onDeleted={handleDeleted}
                  />
                </div>
              </div>
              <Link
                href={`/my-beacon/draft-tracker/${draft.id}`}
                className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                aria-label={`Open the draft ${draft.name}`}
              >
                Open draft
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
