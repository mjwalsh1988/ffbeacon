"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Flag } from "lucide-react";

/**
 * Report control for a public Wall post (and, in sub-phase c, a comment). It is
 * viewer-agnostic at render so the public profile page stays cacheable: auth is
 * resolved at submit time from the API response (a 401 prompts sign-in). The
 * control is a labeled toggle button (aria-expanded / aria-controls) that reveals
 * a reason fieldset plus optional details. Results announce via aria-live.
 */

const REASONS: { value: string; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech" },
  { value: "sexual", label: "Sexual content" },
  { value: "violence", label: "Violence or threats" },
  { value: "other", label: "Something else" },
];

const DETAILS_MAX = 1000;

export function ReportButton({
  targetType,
  targetId,
}: {
  targetType: "post" | "comment";
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const panelId = useId();
  const legendId = useId();
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);

  const openPanel = () => {
    setOpen(true);
    setMessage(null);
    requestAnimationFrame(() => firstRadioRef.current?.focus());
  };

  // Close the panel and return focus to the trigger so keyboard and screen
  // reader users are never stranded on the unmounted panel.
  const closePanel = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (!reason) {
      setMessage("Choose a reason for the report.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/signal/report", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-requested-with": "ff-beacon",
          },
          body: JSON.stringify({ targetType, targetId, reason, details }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          alreadyReported?: boolean;
          error?: string;
        };
        if (res.status === 401) {
          setMessage("Sign in to report content.");
          return;
        }
        if (res.ok && data.ok) {
          setDone(true);
          setOpen(false);
          setMessage(
            data.alreadyReported
              ? "You already reported this. Thank you."
              : "Thank you. Our moderators will review this.",
          );
          // The trigger unmounts on success, so move focus to the confirmation
          // so it is reliably reached rather than dropping to the page body.
          requestAnimationFrame(() => messageRef.current?.focus());
          return;
        }
        setMessage(data.error ?? "Could not submit your report. Please try again.");
      } catch {
        setMessage("Could not submit your report. Please try again.");
      }
    });
  };

  return (
    <div className="mt-1">
      {!done && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? closePanel() : openPanel())}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex h-11 items-center gap-1.5 rounded-card px-2 text-xs font-medium text-ink-subtle hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Flag aria-hidden="true" className="h-3.5 w-3.5" />
          Report
        </button>
      )}

      {open && (
        <form
          id={panelId}
          onSubmit={submit}
          className="mt-2 rounded-card border border-line bg-base p-3"
        >
          <fieldset>
            <legend id={legendId} className="text-xs font-semibold text-ink">
              Why are you reporting this post?
            </legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {REASONS.map((r, index) => (
                <label
                  key={r.value}
                  className="flex items-center gap-2 text-sm text-ink"
                >
                  <input
                    ref={index === 0 ? firstRadioRef : undefined}
                    type="radio"
                    name={`report-reason-${targetId}`}
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="h-4 w-4 accent-[#A855F7]"
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-3 block text-xs font-medium text-ink">
            More details (optional)
            <textarea
              value={details}
              maxLength={DETAILS_MAX}
              onChange={(e) => setDetails(e.target.value)}
              rows={2}
              className="mt-1 w-full resize-y rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink caret-brand-purple focus:border-brand-purple focus:outline-none"
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-11 items-center rounded-card bg-beacon px-4 text-sm font-semibold text-black hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
            >
              {pending ? "Submitting..." : "Submit report"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={closePanel}
              className="inline-flex h-11 items-center rounded-card border border-line px-4 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div aria-live="polite" role="status" className="min-h-[1.1rem]">
        {message && (
          <p
            ref={messageRef}
            tabIndex={-1}
            className="mt-1.5 text-xs text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
