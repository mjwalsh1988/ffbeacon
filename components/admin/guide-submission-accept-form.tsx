"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircleQuestion } from "lucide-react";
import { AdminSwitch, useAdminAnnouncer } from "@/components/admin/admin-controls";
import { createEntryFromSubmission } from "@/app/admin/signal-guide/actions";
import type { GuideEntryKind } from "@/lib/guide/types";
import { GUIDE_BODY_MAX, GUIDE_HEADING_MAX } from "@/lib/guide/validate";

/**
 * Turns a community submission into a published guide entry. Shown at the top of a
 * page manager when arriving via ?submission=<id> (the "Accept" button in the
 * queue, or the link in the admin notification email). The admin:
 *   - picks the destination page (defaults to the page the visitor asked from),
 *   - picks question vs term,
 *   - toggles "show on all pages",
 *   - edits the heading (prefilled with the visitor's question) and writes the
 *     answer/explanation.
 * On save it creates the entry, marks the submission accepted, and navigates to
 * the destination page's manager.
 */
export function GuideSubmissionAcceptForm({
  submissionId,
  submitterName,
  submitterEmail,
  questionText,
  defaultPageKey,
  pages,
}: {
  submissionId: string;
  submitterName: string;
  submitterEmail: string | null;
  questionText: string;
  defaultPageKey: string;
  pages: Array<{ page_key: string; title: string }>;
}) {
  const router = useRouter();
  const uid = useId();
  const headingId = useId();
  const { announce, region } = useAdminAnnouncer();
  const headingFieldRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<GuideEntryKind>("question");
  const [targetPageKey, setTargetPageKey] = useState(defaultPageKey);
  const [isGlobal, setIsGlobal] = useState(false);
  const [heading, setHeading] = useState(questionText);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const bodyLabel = kind === "question" ? "Answer" : "Explanation";

  const submit = () => {
    setError("");
    if (!heading.trim()) {
      setError(kind === "question" ? "Enter the question." : "Enter the term.");
      headingFieldRef.current?.focus();
      return;
    }
    if (!body.trim()) {
      setError(`Enter the ${bodyLabel.toLowerCase()}.`);
      return;
    }
    startTransition(async () => {
      const res = await createEntryFromSubmission(submissionId, targetPageKey, {
        kind,
        heading: heading.trim(),
        body: body.trim(),
        isGlobal,
      });
      if (!res.ok) {
        setError(res.error);
        announce(`Could not save: ${res.error}`);
        return;
      }
      announce("Question accepted and published.");
      router.push(`/admin/signal-guide/${encodeURIComponent(res.pageKey)}`);
      router.refresh();
    });
  };

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-brand-purple/50 bg-brand-purple/5 p-4 sm:p-5"
    >
      {region}
      <h2
        id={headingId}
        className="flex items-center gap-2 text-base font-semibold text-ink"
      >
        <MessageCircleQuestion aria-hidden="true" className="h-5 w-5 text-brand-cyan" />
        Answer this community question
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        From <span className="font-semibold text-ink">{submitterName}</span>
        {submitterEmail ? (
          <>
            {" "}
            (<a className="text-brand-cyan hover:underline" href={`mailto:${submitterEmail}`}>
              {submitterEmail}
            </a>
            )
          </>
        ) : (
          " (no email provided)"
        )}
        . Write the answer below, choose where it should appear, then publish.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-card border border-signal-danger bg-signal-danger/10 px-3 py-2 text-sm text-ink"
        >
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-4">
        <fieldset className="grid gap-1">
          <legend className="text-sm font-semibold text-ink">Add this as a</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {(["question", "term"] as const).map((k) => (
              <label
                key={k}
                className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-card border px-3 text-sm font-semibold ${
                  kind === k
                    ? "border-brand-cyan bg-brand-cyan/10 text-ink"
                    : "border-line bg-base text-ink-muted"
                }`}
              >
                <input
                  type="radio"
                  name={`${uid}-kind`}
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="h-4 w-4 accent-brand-cyan"
                />
                {k === "question" ? "Question" : "Term or metric"}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-1">
          <label htmlFor={`${uid}-page`} className="text-sm font-semibold text-ink">
            Show on page
          </label>
          <select
            id={`${uid}-page`}
            value={targetPageKey}
            onChange={(e) => setTargetPageKey(e.target.value)}
            disabled={isGlobal}
            aria-describedby={isGlobal ? `${uid}-page-note` : undefined}
            className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
          >
            {pages.map((p) => (
              <option key={p.page_key} value={p.page_key}>
                {p.title}
              </option>
            ))}
          </select>
          {isGlobal && (
            <p id={`${uid}-page-note`} className="text-xs text-ink-muted">
              Ignored while &quot;Show on all pages&quot; is on.
            </p>
          )}
        </div>

        <div className="flex items-start gap-3 rounded-card border border-line bg-base/60 p-3">
          <AdminSwitch
            checked={isGlobal}
            disabled={pending}
            label={
              isGlobal
                ? "Shown on all pages, click to limit to one page"
                : "Shown on one page, click to show on all pages"
            }
            onChange={setIsGlobal}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Show on all pages</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
              {isGlobal
                ? "This answer will appear in the guide on every page."
                : "This answer will appear only on the page selected above."}
            </p>
          </div>
        </div>

        <div className="grid gap-1">
          <label htmlFor={`${uid}-heading`} className="text-sm font-semibold text-ink">
            {kind === "question" ? "Question" : "Term or metric"}
          </label>
          <input
            ref={headingFieldRef}
            id={`${uid}-heading`}
            type="text"
            value={heading}
            maxLength={GUIDE_HEADING_MAX}
            onChange={(e) => setHeading(e.target.value)}
            className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </div>

        <div className="grid gap-1">
          <label htmlFor={`${uid}-body`} className="text-sm font-semibold text-ink">
            {bodyLabel}
          </label>
          <textarea
            id={`${uid}-body`}
            value={body}
            maxLength={GUIDE_BODY_MAX}
            rows={5}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Write the ${bodyLabel.toLowerCase()} the visitor was looking for.`}
            className="min-h-[110px] rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="inline-flex min-h-[44px] items-center rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
          >
            {pending ? "Publishing..." : "Publish answer"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => router.push("/admin/signal-guide/submissions")}
            className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
