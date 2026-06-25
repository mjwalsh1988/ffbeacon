"use client";

import { useState, useTransition } from "react";
import {
  deleteFilteredPost,
  forcePushFiltered,
} from "@/app/admin/beacon-brief/actions";
import { formatEastern } from "@/lib/datetime";
import { PostContext, type IngestedPost } from "./moderation-manager";

/** One post held in the Filtered review queue. */
export interface FilteredItem {
  id: string;
  created_at: string;
  /** "keyword" | "ai_non_football". */
  reason: "keyword" | "ai_non_football";
  /** Blocklist terms that matched (keyword reason only). */
  matchedTerms: string[];
  /** The AI's suggested headline, when it was classified (non-football reason). */
  suggestedTitle: string | null;
  post: IngestedPost | null;
}

type Status = { msg: string; error: boolean } | null;

const btnClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan disabled:opacity-50";

function reasonLabel(reason: FilteredItem["reason"]): string {
  return reason === "keyword"
    ? "Blocked keyword"
    : "AI flagged as non-football";
}

export function FilteredManager({ items }: { items: FilteredItem[] }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(null);

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) =>
    startTransition(async () => {
      setStatus(null);
      const res = await fn();
      setStatus(
        res.ok
          ? { msg: okMsg, error: false }
          : { msg: `Failed: ${res.error}`, error: true },
      );
    });

  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Nothing has been filtered out. Posts caught by the keyword blocklist or
        flagged as non-football by the AI will appear here for review.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p
        role="status"
        aria-live="polite"
        className="min-h-[1.25rem] text-sm text-ink-muted"
      >
        {status && !status.error ? status.msg : ""}
      </p>
      <p
        role="alert"
        aria-live="assertive"
        className="text-sm text-signal-danger"
      >
        {status && status.error ? status.msg : ""}
      </p>
      <ul className="space-y-3">
        {items.map((item) => {
          const headline =
            item.suggestedTitle ?? item.post?.text?.slice(0, 60) ?? "this post";
          return (
            <li
              key={item.id}
              className="rounded-card border border-line bg-surface/60 p-4"
            >
              <PostContext post={item.post} label="Filtered post" />
              <p className="font-medium text-ink">
                Filtered:{" "}
                <span className="text-brand-cyan">
                  {reasonLabel(item.reason)}
                </span>
              </p>
              {item.reason === "keyword" && item.matchedTerms.length > 0 ? (
                <p className="mt-1 text-sm text-ink-muted">
                  Matched{" "}
                  {item.matchedTerms.length === 1 ? "keyword" : "keywords"}:{" "}
                  <span className="font-semibold text-ink">
                    {item.matchedTerms.join(", ")}
                  </span>
                </p>
              ) : null}
              {item.reason === "ai_non_football" && item.suggestedTitle ? (
                <p className="mt-1 text-sm text-ink-muted">
                  The classifier read this as not about football. Its suggested
                  headline was: {item.suggestedTitle}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-ink-muted">
                This post was held back from Discord and was not turned into an
                article. Force it through to publish it anyway (this bypasses
                both filters), or delete it to remove it from the system.
              </p>
              <p className="mt-1 text-xs text-ink-subtle">
                Filtered {formatEastern(item.created_at)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  className={btnClass}
                  onClick={() =>
                    run(
                      () => forcePushFiltered(item.id),
                      "Force-pushed back into the pipeline.",
                    )
                  }
                  aria-label={`Force "${headline}" through the pipeline, bypassing both filters`}
                >
                  Force through pipeline
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className={`${btnClass} hover:border-signal-danger`}
                  onClick={() => {
                    if (
                      confirm(
                        "Delete this post entirely? This permanently removes it from the system and cannot be undone.",
                      )
                    ) {
                      run(
                        () => deleteFilteredPost(item.id),
                        "Deleted from the system.",
                      );
                    }
                  }}
                  aria-label={`Permanently delete "${headline}" from the system`}
                >
                  Delete permanently
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
