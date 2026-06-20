"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Mail, Send } from "lucide-react";

/**
 * The "ask the Signal team" form shown when a visitor can't find their answer in
 * the guide. Rendered as the second pane of the Signal Guide panel (slides in from
 * the right). Fully keyboard + screen-reader operable:
 *   - real <label> per field, required state announced,
 *   - one error alert (role="alert") and one success status (role="status"),
 *   - a honeypot field hidden from BOTH sight and the a11y tree so neither sighted
 *     nor screen-reader users ever fill it; only bots do.
 *
 * Prefill: when the visitor is signed in, name + email are fetched once from
 * /api/guide/viewer. Email is optional; providing it guarantees a reply.
 */
export function SubmitQuestionForm({
  pageKey,
  pageTitle,
  active,
  onBack,
}: {
  pageKey: string;
  pageTitle: string;
  /** True when this pane is the visible one (drives autofocus). */
  active: boolean;
  onBack: () => void;
}) {
  const uid = useId();
  const headingId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [question, setQuestion] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState("");
  const prefillDone = useRef(false);

  // Fetch prefill once, the first time this pane becomes active.
  useEffect(() => {
    if (!active || prefillDone.current) return;
    prefillDone.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/guide/viewer");
        if (!res.ok) return;
        const data = (await res.json()) as { name: string | null; email: string | null };
        if (cancelled) return;
        if (data.name) setName((prev) => prev || data.name!);
        if (data.email) setEmail((prev) => prev || data.email!);
      } catch {
        // No prefill available; the visitor types their details.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Move focus to the first field when this pane slides in.
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => nameRef.current?.focus(), 320);
    return () => window.clearTimeout(t);
  }, [active]);

  const submit = async () => {
    setError("");
    if (!name.trim()) {
      setError("Enter your name so we know who is asking.");
      nameRef.current?.focus();
      return;
    }
    if (!question.trim()) {
      setError("Enter your question.");
      questionRef.current?.focus();
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/guide/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageKey, name, email, question, company }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus("idle");
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("idle");
      setError("We could not reach the server. Please check your connection and try again.");
    }
  };

  if (status === "done") {
    return (
      <div className="flex h-full flex-col px-5 py-6">
        <div
          role="status"
          className="flex flex-1 flex-col items-center justify-center text-center"
        >
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-purple to-brand-cyan text-black">
            <CheckCircle2 aria-hidden="true" className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-ink">Question received</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
            Thanks{name ? `, ${name.split(" ")[0]}` : ""}. We will add a clear answer to the
            Signal knowledge base.
            {email
              ? " Because you shared your email, we will also reply directly once it is answered."
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to the guide
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-5 pt-4">
        <button
          ref={backRef}
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to the guide
        </button>
        <h2 id={headingId} className="mt-3 text-base font-semibold text-ink">
          Ask the Signal team
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Didn&apos;t find what you needed on {pageTitle}? Send your question and we&apos;ll add
          it to the Signal knowledge base.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <form
          aria-labelledby={headingId}
          onSubmit={(e) => {
            e.preventDefault();
            if (status !== "submitting") submit();
          }}
          className="grid gap-4"
        >
          {error && (
            <p
              role="alert"
              className="rounded-card border border-signal-danger bg-signal-danger/10 px-3 py-2 text-sm text-ink"
            >
              {error}
            </p>
          )}

          <div className="grid gap-1">
            <label htmlFor={`${uid}-name`} className="text-sm font-semibold text-ink">
              Your name
            </label>
            <input
              ref={nameRef}
              id={`${uid}-name`}
              type="text"
              required
              aria-required="true"
              autoComplete="name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            />
          </div>

          <div className="grid gap-1">
            <label htmlFor={`${uid}-email`} className="text-sm font-semibold text-ink">
              Email{" "}
              <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <input
              id={`${uid}-email`}
              type="email"
              autoComplete="email"
              value={email}
              maxLength={320}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={`${uid}-email-help`}
              className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            />
            <p
              id={`${uid}-email-help`}
              className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted"
            >
              <Mail aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-cyan" />
              <span>
                Add your email and we&apos;ll reply with the answer once it&apos;s ready. Sharing it
                guarantees a response from our team.
              </span>
            </p>
          </div>

          <div className="grid gap-1">
            <label htmlFor={`${uid}-question`} className="text-sm font-semibold text-ink">
              Your question
            </label>
            <textarea
              ref={questionRef}
              id={`${uid}-question`}
              required
              aria-required="true"
              value={question}
              maxLength={2000}
              rows={5}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What would you like explained?"
              className="min-h-[110px] rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            />
          </div>

          {/* Honeypot: hidden from sight AND the accessibility tree (aria-hidden +
              off-screen + not tabbable). Only an automated bot will fill it. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-9999px",
              width: "1px",
              height: "1px",
              overflow: "hidden",
            }}
          >
            <label htmlFor={`${uid}-company`}>Company (leave this blank)</label>
            <input
              id={`${uid}-company`}
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={status === "submitting"}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
          >
            <Send aria-hidden="true" className="h-4 w-4" />
            {status === "submitting" ? "Sending..." : "Send question"}
          </button>
        </form>
      </div>
    </div>
  );
}
