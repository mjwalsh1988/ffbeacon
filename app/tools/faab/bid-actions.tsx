"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ImageDown } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import { copyText, shareImageHref, type BidView } from "./bid-view";
import type { GoalKey } from "@/lib/faab/types";

/**
 * Taking the answer somewhere else.
 *
 * Two clipboard buttons and, in league mode, the all-leagues action the panel
 * already owns. Nothing here opens a share sheet or a new tab: a FAAB bid is
 * something people paste into a league chat, and a string and a picture are
 * what those chats accept.
 *
 * NO LIVE REGION IN HERE. There is exactly one polite region per mode, owned
 * by whichever parent owns the answer, so the outcome is handed up through
 * `onAnnounce` and said once. The button's own label changes too, because a
 * live region a reader has scrolled past is not a confirmation on its own.
 *
 * Every failure is its own state rather than a silent one: a browser that
 * refuses the clipboard shows the text in a field the reader can select, and
 * says so.
 */
export function BidActions({
  view,
  goal,
  onAnnounce,
  allLeaguesAction,
}: {
  view: BidView;
  goal: GoalKey;
  /** Hands the outcome to the parent's polite live region. */
  onAnnounce: (message: string) => void;
  /** League mode only: the existing "check every league" control. */
  allLeaguesAction?: ReactNode;
}) {
  const [copied, setCopied] = useState<"bid" | "image" | null>(null);
  const [manualText, setManualText] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const settle = (which: "bid" | "image") => {
    setCopied(which);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(null), 4000);
  };

  const write = async (text: string, which: "bid" | "image", spoken: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setManualText(null);
      settle(which);
      onAnnounce(spoken);
      trackEvent("share", { method: "copy_link", content_type: "faab_bid" });
    } catch {
      // The floor: show it, say so, let the reader copy it themselves.
      setManualText(text);
      onAnnounce("Your browser would not let us use the clipboard. The text is in the field below, ready to copy.");
    }
  };

  const imageHref = shareImageHref(view, goal);

  return (
    <div className="rounded-card border border-line bg-surface/40 p-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() =>
            write(
              copyText(view, goal),
              "bid",
              "Copied the bid to your clipboard.",
            )
          }
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {copied === "bid" ? (
            <Check aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          ) : (
            <Copy aria-hidden="true" className="h-4 w-4" />
          )}
          {copied === "bid" ? "Copied" : "Copy bid"}
        </button>

        {imageHref && (
          <button
            type="button"
            onClick={() =>
              write(
                typeof window === "undefined"
                  ? imageHref
                  : `${window.location.origin}${imageHref}`,
                "image",
                "Copied a link to the share image.",
              )
            }
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {copied === "image" ? (
              <Check aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
            ) : (
              <ImageDown aria-hidden="true" className="h-4 w-4" />
            )}
            {copied === "image" ? "Link copied" : "Share image"}
          </button>
        )}

        {allLeaguesAction}
      </div>

      {manualText !== null && (
        <div className="mt-3">
          <label
            htmlFor="faab-copy-fallback"
            className="block text-sm font-medium text-ink"
          >
            Copy this text
          </label>
          <input
            id="faab-copy-fallback"
            readOnly
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
          />
        </div>
      )}
    </div>
  );
}
