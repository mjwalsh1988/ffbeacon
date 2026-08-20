"use client";

/**
 * "Report incorrect format" dialog for On The Clock. Opened from the one-time
 * pool/format notice when a user believes the auto-detected league format is
 * wrong. Collects the reporter's name + email (and an optional note), then POSTs
 * the report plus the league context to /api/on-the-clock/report-format, which
 * emails the team. On success it thanks the reporter and sets expectations.
 *
 * Accessible dialog semantics: role=dialog, aria-modal, labelled title, focus
 * moves into the dialog on open and returns to the opener on close, Tab is trapped
 * within the dialog, Escape closes. Validation errors and the success state are
 * announced to screen readers via live regions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { validateFormatReportInput } from "@/lib/on-the-clock/report-validate";

export type FormatReportContext = {
  sleeperUsername: string;
  leagueName: string;
  leagueId: string;
  draftId: string;
  season: string;
  totalRosters: number | null;
  draftStatus: string | null;
  assignedFormatLabel: string;
  assignedFormatSlug: string | null;
  derivedFormatLabel: string | null;
  isClosestMatch: boolean;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ReportFormatDialog({
  open,
  context,
  onClose,
}: {
  open: boolean;
  context: FormatReportContext;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const doneCloseRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [details, setDetails] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Reset transient state each time the dialog opens so a prior submission's
  // "Report sent" screen (or a stale error) never carries into a fresh open,
  // including when the user switches to a different league.
  useEffect(() => {
    if (open) {
      setDone(false);
      setError(null);
    }
  }, [open]);

  // Focus management: remember the opener, focus the first field, restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // On a successful send the form unmounts; move focus into the confirmation so
  // keyboard/screen-reader users are not dropped back to the top of the document.
  useEffect(() => {
    if (done) doneCloseRef.current?.focus();
  }, [done]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.tabIndex !== -1 && (el.offsetParent !== null || el === document.activeElement),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const assignedText = useMemo(
    () =>
      context.assignedFormatSlug
        ? `${context.assignedFormatLabel} (${context.assignedFormatSlug})`
        : context.assignedFormatLabel,
    [context.assignedFormatLabel, context.assignedFormatSlug],
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    // Validate client-side with the same rules the server enforces.
    const v = validateFormatReportInput({
      reporterName: name,
      reporterEmail: email,
      sleeperUsername: context.sleeperUsername,
      leagueName: context.leagueName,
      leagueId: context.leagueId,
      draftId: context.draftId,
      season: context.season,
      totalRosters: context.totalRosters,
      draftStatus: context.draftStatus,
      assignedFormatLabel: context.assignedFormatLabel,
      assignedFormatSlug: context.assignedFormatSlug,
      derivedFormatLabel: context.derivedFormatLabel,
      isClosestMatch: context.isClosestMatch,
      details,
    });
    if (!v.ok) {
      setError(v.error);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/on-the-clock/report-format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v.value, company }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setDone(true);
      } else {
        setError(data?.error ?? "Something went wrong sending your report. Please try again.");
      }
    } catch {
      setError("We could not reach the server. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center"
      onKeyDown={onKeyDown}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="otc-report-format-title"
        className="relative w-full max-w-md overflow-hidden rounded-modal border border-brand-purple/30 bg-surface p-5 shadow-[0_0_80px_-30px_rgba(168,85,247,0.55)] sm:p-6"
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />

        {done ? (
          <div>
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-emerald-400/40 bg-base text-emerald-400"
              >
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
                  Report sent
                </p>
                <h2
                  id="otc-report-format-title"
                  className="mt-1 text-lg font-semibold tracking-tight text-ink"
                >
                  Thanks for the heads up
                </h2>
              </div>
              <DialogClose onClose={onClose} label="Close this dialog" />
            </div>
            <p role="status" className="mt-3 text-sm leading-relaxed text-ink-muted">
              A developer will review this and fix it within a day or two. We apologize for the
              inconvenience.
            </p>
            <div className="mt-5">
              <button
                ref={doneCloseRef}
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-amber-400/40 bg-base text-amber-300"
              >
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                  Report a problem
                </p>
                <h2
                  id="otc-report-format-title"
                  className="mt-1 text-lg font-semibold tracking-tight text-ink"
                >
                  Report an incorrect format
                </h2>
              </div>
              <DialogClose onClose={onClose} label="Close without sending a report" />
            </div>

            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              We detected{" "}
              <span className="font-medium text-ink">{context.assignedFormatLabel}</span> for{" "}
              <span className="font-medium text-ink">{context.leagueName}</span>. If that is wrong,
              tell us and a developer will review it.
            </p>

            <dl className="mt-3 rounded-card border border-line bg-base/60 px-3 py-2 text-xs text-ink-subtle">
              <div className="flex justify-between gap-3 py-0.5">
                <dt>Detected format</dt>
                <dd className="text-right font-medium text-ink">{assignedText}</dd>
              </div>
              {context.derivedFormatLabel && (
                <div className="flex justify-between gap-3 py-0.5">
                  <dt>Your league looks like</dt>
                  <dd className="text-right text-ink-muted">{context.derivedFormatLabel}</dd>
                </div>
              )}
            </dl>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-card border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              >
                {error}
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="otc-report-name" className="block text-sm font-medium text-ink">
                  Your name
                </label>
                <input
                  ref={firstFieldRef}
                  id="otc-report-name"
                  name="name"
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
                />
              </div>
              <div>
                <label htmlFor="otc-report-email" className="block text-sm font-medium text-ink">
                  Your email
                </label>
                <input
                  id="otc-report-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
                />
              </div>
              <div>
                <label htmlFor="otc-report-details" className="block text-sm font-medium text-ink">
                  What is wrong?{" "}
                  <span className="font-normal text-ink-subtle">(optional)</span>
                </label>
                <textarea
                  id="otc-report-details"
                  name="details"
                  rows={3}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="e.g. This is a dynasty superflex league, not redraft."
                  className="mt-1.5 w-full resize-y rounded-card border border-line bg-base px-3 py-2.5 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
                />
              </div>
            </div>

            {/* Honeypot: hidden from real users; a bot that fills it is rejected. */}
            <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
              <label htmlFor="otc-report-company">Company</label>
              <input
                id="otc-report-company"
                name="company"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
              >
                {submitting ? "Sending..." : "Send report"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Corner close, shared by both states of the dialog. The footer buttons say
 * what they do in words; this is the one people look for without reading.
 */
function DialogClose({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-ink-muted transition-colors hover:bg-base hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <X aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
