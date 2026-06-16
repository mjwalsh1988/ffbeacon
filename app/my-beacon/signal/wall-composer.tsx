"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import {
  POST_BODY_MAX,
  POST_LINKS_MAX,
  codePointLength,
  countLinks,
  graphemeLength,
} from "@/lib/signal";
import { createPost } from "./wall-actions";

/**
 * Composer for a new Wall post (owner only). The character counter shows a
 * grapheme-aware count for readability, but the over-limit gate uses
 * codePointLength so it agrees exactly with the database char_length CHECK (see
 * the note in lib/signal.ts). Link count mirrors the server max-3 cap. The submit
 * button is disabled while empty, over a limit, or pending. A polite live region
 * confirms success; an assertive region carries errors, including the friendly
 * rate-limit copy mapped from the DB trigger.
 */
export function WallComposer() {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const fieldId = useId();
  const helpId = useId();

  const codePoints = codePointLength(body);
  const graphemes = graphemeLength(body);
  const links = countLinks(body);
  const trimmedEmpty = body.trim().length === 0;
  const overLength = codePoints > POST_BODY_MAX;
  const overLinks = links > POST_LINKS_MAX;
  const disabled = pending || trimmedEmpty || overLength || overLinks;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setStatus("");
    if (disabled) return;
    startTransition(async () => {
      const res = await createPost(body.trim());
      if (res.ok) {
        setBody("");
        setStatus("Post published.");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-card border border-line bg-surface p-5 sm:p-6"
    >
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        Write a post
      </label>
      <p id={helpId} className="mt-1 text-xs text-ink-subtle">
        Up to {POST_BODY_MAX} characters and {POST_LINKS_MAX} links. Emoji can
        count as several characters, so the limit is measured the way the server
        stores it.
      </p>
      <textarea
        id={fieldId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-describedby={helpId}
        aria-invalid={overLength || overLinks}
        rows={4}
        placeholder="Share a take, a lineup call, or a link."
        className="mt-2 w-full resize-y rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <span
          className={overLength ? "font-semibold text-signal-danger" : "text-ink-subtle"}
        >
          {graphemes} characters
          {overLength ? " (over the limit)" : ` of ${POST_BODY_MAX}`}
        </span>
        <span
          className={overLinks ? "font-semibold text-signal-danger" : "text-ink-subtle"}
        >
          {links} of {POST_LINKS_MAX} links
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Send aria-hidden="true" className="h-4 w-4" />
          {pending ? "Posting..." : "Post"}
        </button>
        <p aria-live="polite" role="status" className="min-h-[1.25rem] text-sm text-signal-success">
          {status}
        </p>
      </div>

      <div aria-live="assertive" className="min-h-[1.25rem]">
        {error && (
          <p role="alert" className="mt-2 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
