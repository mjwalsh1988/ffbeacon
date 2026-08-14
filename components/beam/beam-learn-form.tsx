"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Mail, Send, X } from "lucide-react";
import {
  BEAM_MESSAGE_MAX,
  BEAM_NAME_MAX,
  BEAM_EMAIL_MAX,
} from "@/lib/beam/validate";

/**
 * "Help BEAM learn this".
 *
 * The exit from a dead end. Deliberately the same shape as the Signal Guide's
 * question form (components/signal-guide/submit-question-form.tsx), because it
 * is the same job and readers should not have to learn two forms.
 *
 * THE QUESTION IS NOT RETYPED. It is shown read-only above the fields with a
 * visible label, and the queryId travels with the submission so the server can
 * pair the request with the exact parse that failed. Making someone retype the
 * question they just asked is the fastest way to get zero submissions.
 *
 * Accessibility: real labels, one role="alert" for errors, one role="status" for
 * success, focus moved to the confirmation heading on success, and a honeypot
 * hidden from BOTH sight and the accessibility tree so no human ever meets it.
 */
export function BeamLearnForm({
  question,
  queryId,
  onCancel,
  onDone,
}: {
  question: string;
  queryId: string | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const uid = useId();
  const headingId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const id = window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (status !== "done") return;
    const id = window.requestAnimationFrame(() => doneHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [status]);

  const submit = async () => {
    setError("");
    if (!name.trim()) {
      setError("Enter your name so we know who is asking.");
      nameRef.current?.focus();
      return;
    }
    setStatus("submitting");
    try {
      const res = await fetch("/api/beam/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId, question, name, email, message, company }),
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
      setError("We could not reach the server. Check your connection and try again.");
    }
  };

  if (status === "done") {
    // No role="status" on this container. Focus moves to the heading below, and
    // a focus change already announces it; a live region as well would speak the
    // same sentence twice.
    return (
      <div className="rounded-card border border-line bg-surface/60 p-5 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-purple to-brand-cyan text-black">
          <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
        </span>
        <h3
          ref={doneHeadingRef}
          tabIndex={-1}
          className="mt-3 text-base font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Got it{name ? `, ${name.split(" ")[0]}` : ""}. BEAM is taking notes.
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
          We read every one of these. The questions people ask most are the ones BEAM
          learns next.
          {email ? " We will email you when this one works." : ""}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Ask something else
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-brand-purple/40 bg-surface/60 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 id={headingId} className="text-base font-semibold text-ink">
          Help BEAM learn this
        </h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close the BEAM feedback form"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-ink-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>

      <form
        aria-labelledby={headingId}
        onSubmit={(e) => {
          e.preventDefault();
          if (status !== "submitting") submit();
        }}
        className="mt-3 grid gap-4"
      >
        {error && (
          <p
            role="alert"
            className="rounded-card border border-signal-danger bg-signal-danger/10 px-3 py-2 text-sm text-ink"
          >
            {error}
          </p>
        )}

        {/* The question travels automatically. Shown, not retyped. */}
        <div className="grid gap-1">
          <p id={`${uid}-q-label`} className="text-sm font-semibold text-ink">
            Your question (sent with this)
          </p>
          {/* role="group" because a bare <p> has an implicit generic role,
              which prohibits an author-supplied accessible name, so the
              aria-labelledby was being ignored by most screen readers. */}
          <div
            role="group"
            aria-labelledby={`${uid}-q-label`}
            className="rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink-muted"
          >
            {question}
          </div>
        </div>

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
            maxLength={BEAM_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </div>

        <div className="grid gap-1">
          <label htmlFor={`${uid}-email`} className="text-sm font-semibold text-ink">
            Email <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <input
            id={`${uid}-email`}
            type="email"
            autoComplete="email"
            value={email}
            maxLength={BEAM_EMAIL_MAX}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={`${uid}-email-help`}
            className="min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
          <p
            id={`${uid}-email-help`}
            className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted"
          >
            <Mail aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-cyan" />
            <span>Add it and we will tell you when BEAM can answer this.</span>
          </p>
        </div>

        <div className="grid gap-1">
          <label htmlFor={`${uid}-message`} className="text-sm font-semibold text-ink">
            Anything else? <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <textarea
            id={`${uid}-message`}
            value={message}
            maxLength={BEAM_MESSAGE_MAX}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What answer were you hoping for?"
            className="min-h-[88px] rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </div>

        {/* Honeypot: hidden from sight AND the accessibility tree. */}
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
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
        >
          <Send aria-hidden="true" className="h-4 w-4" />
          {status === "submitting" ? "Sending..." : "Send it to the team"}
        </button>
      </form>
    </div>
  );
}
