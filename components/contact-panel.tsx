"use client";

/**
 * The "send us a message" panel that sits in the rail on About and the author
 * page.
 *
 * It posts to /api/guide/submit, the same intake the Signal Guide's question
 * form uses, with this page's `page_key`. That route already carries the parts
 * that matter: a same-origin check, a honeypot, server-side validation, a
 * per-IP rate limit, and the email to the team plus a confirmation to the
 * sender. A second endpoint would have meant a second copy of all of it to keep
 * hardened, and messages would land in two inboxes instead of one queue.
 *
 * Operable by keyboard and by screen reader:
 *   - a real <label> on every field, required state announced,
 *   - one error alert (role="alert") and one success status (role="status"),
 *   - the honeypot is hidden from sight AND from the accessibility tree, so
 *     nobody who is actually reading the page can fill it in by mistake,
 *   - focus moves to whichever field the error is about.
 */

import { useId, useRef, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";

export function ContactPanel({
  pageKey,
  title = "Send us a message",
  eyebrow = "Contact",
  helper = "Questions, bug reports, and feedback all land in the same inbox, and a person reads every one.",
  promptLabel = "Your message",
  placeholder = "What is on your mind?",
}: {
  /** Which page the message came from. Must match a guide_pages key. */
  pageKey: string;
  title?: string;
  eyebrow?: string;
  helper?: string;
  promptLabel?: string;
  placeholder?: string;
}) {
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!name.trim()) {
      setError("Enter your name so we know who is writing.");
      nameRef.current?.focus();
      return;
    }
    if (!message.trim()) {
      setError("Enter your message.");
      messageRef.current?.focus();
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/guide/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageKey, name, email, question: message, company }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setStatus("idle");
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("idle");
      setError("We could not reach the server. Check your connection and try again.");
    }
  };

  if (status === "sent") {
    return (
      <Panel eyebrow={eyebrow} title="Message sent" headingLevel={2}>
        <div role="status" className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
          >
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <p className="text-sm leading-relaxed text-ink-muted">
            Thanks{name ? `, ${name.split(" ")[0]}` : ""}. It is in the queue.
            {email
              ? " You gave us an email, so the reply comes straight back to you."
              : " Add an email next time if you want a reply rather than just a read."}
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel eyebrow={eyebrow} title={title} helper={helper} headingLevel={2} glow>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (status !== "sending") submit();
        }}
        className="grid gap-3"
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
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
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
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={`${uid}-email-help`}
            className="min-h-11 rounded-card border border-line bg-base px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
          <p id={`${uid}-email-help`} className="text-xs leading-relaxed text-ink-muted">
            Leave it out and we will still read the message. Include it and you get a
            reply.
          </p>
        </div>

        <div className="grid gap-1">
          <label htmlFor={`${uid}-message`} className="text-sm font-semibold text-ink">
            {promptLabel}
          </label>
          <textarea
            ref={messageRef}
            id={`${uid}-message`}
            required
            aria-required="true"
            rows={5}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={placeholder}
            className="min-h-[7rem] rounded-card border border-line bg-base px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
        </div>

        {/* Honeypot. Hidden from sight and from the accessibility tree, and out
            of the tab order, so only an automated submission fills it. */}
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
          disabled={status === "sending"}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
        >
          <Send aria-hidden="true" className="h-4 w-4" />
          {status === "sending" ? "Sending" : "Send message"}
        </button>
      </form>
    </Panel>
  );
}
