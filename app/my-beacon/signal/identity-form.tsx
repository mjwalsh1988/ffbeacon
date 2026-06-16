"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { saveIdentity } from "./actions";
import { DISPLAY_NAME_MAX, HEADLINE_MAX, BIO_MAX } from "@/lib/signal";

/**
 * Identity editor for a Signal: public display name, headline, and bio. Writes
 * through the saveIdentity server action (owner-only RLS). Status is announced
 * for screen readers via a polite live region, errors via role="alert".
 */
export function IdentityForm({
  initialDisplayName,
  initialHeadline,
  initialBio,
}: {
  initialDisplayName: string;
  initialHeadline: string;
  initialBio: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [headline, setHeadline] = useState(initialHeadline);
  const [bio, setBio] = useState(initialBio);
  const [status, setStatus] = useState<
    { kind: "idle" | "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const nameId = useId();
  const headlineId = useId();
  const bioId = useId();
  const bioHintId = useId();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const res = await saveIdentity({ displayName, headline, bio });
      if (res.ok) {
        setStatus({ kind: "saved" });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: res.error });
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6 rounded-card border border-line bg-surface p-5 sm:p-6">
      <div>
        <label htmlFor={nameId} className="block text-sm font-medium text-ink">
          Display name
        </label>
        <input
          id={nameId}
          value={displayName}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="nickname"
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none sm:text-sm"
        />
      </div>

      <div>
        <label htmlFor={headlineId} className="block text-sm font-medium text-ink">
          Headline
        </label>
        <input
          id={headlineId}
          value={headline}
          maxLength={HEADLINE_MAX}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="Dynasty rebuilder. Best ball degenerate. Stats first."
          className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none sm:text-sm"
        />
      </div>

      <div>
        <label htmlFor={bioId} className="block text-sm font-medium text-ink">
          Bio
        </label>
        <textarea
          id={bioId}
          value={bio}
          maxLength={BIO_MAX}
          rows={4}
          aria-describedby={bioHintId}
          onChange={(e) => setBio(e.target.value)}
          placeholder="A few sentences about you and how you play."
          className="mt-2 w-full resize-y rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none sm:text-sm"
        />
        <p id={bioHintId} className="mt-1 text-xs text-ink-subtle">
          {bio.trim().length}/{BIO_MAX} characters.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {pending ? "Saving..." : "Save details"}
        </button>
        <div aria-live="polite" role="status" className="min-h-[1.25rem] text-sm">
          {status.kind === "saved" && <p className="text-signal-success">Details saved.</p>}
          {status.kind === "error" && (
            <p role="alert" className="text-signal-danger">
              {status.message}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
