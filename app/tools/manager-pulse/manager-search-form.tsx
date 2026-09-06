"use client";

/**
 * The one-field entry to a Manager Pulse report.
 *
 * Validates the handle shape CLIENT-SIDE before navigating, so a bad handle
 * (spaces, punctuation, an empty field) never costs a round trip to
 * `/tools/manager-pulse/[handle]`, which re-validates and resolves against
 * Sleeper server-side regardless (isValidSleeperHandle is the same function
 * either place runs it, from lib/manager-pulse/discover.ts).
 *
 * Lowercased before validating and before it goes in the URL: Sleeper handles
 * are case-insensitive to the person typing them, but the grammar this checks
 * against (HANDLE_PATTERN) is lowercase-only by design (see the comment on
 * isValidSleeperHandle), so this is the one place that has to be forgiving
 * about case.
 */

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { isValidSleeperHandle } from "@/lib/manager-pulse/handle";

export function ManagerSearchForm({ defaultHandle = "" }: { defaultHandle?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultHandle);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorId = useId();
  const helpId = useId();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const handle = value.trim().toLowerCase();

    if (!handle) {
      setError("Enter a Sleeper handle.");
      return;
    }
    if (!isValidSleeperHandle(handle)) {
      setError(
        "That doesn't look like a Sleeper handle. Use letters, numbers, and underscores only, up to 32 characters.",
      );
      return;
    }

    setError(null);
    startTransition(() => {
      router.push(`/tools/manager-pulse/${encodeURIComponent(handle)}`);
    });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="relative overflow-hidden rounded-modal border border-brand-purple/30 bg-surface p-5 sm:p-6"
      style={{
        boxShadow: "0 0 90px -36px rgba(168, 85, 247, 0.55)",
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.10) 0%, transparent 55%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="manager-handle" className="block text-sm font-medium text-ink">
            Sleeper handle
          </label>
          <input
            id="manager-handle"
            name="handle"
            autoComplete="off"
            required
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${helpId}` : helpId}
            placeholder="their-sleeper-handle"
            className={`mt-2 min-h-11 w-full rounded-card border bg-base px-3 py-2.5 text-sm placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
              error ? "border-signal-danger" : "border-line"
            }`}
          />
        </div>
        <div className="sm:self-end">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
          >
            <Search aria-hidden="true" className="h-3.5 w-3.5" />
            {pending ? "Looking up..." : "Look up manager"}
          </button>
        </div>
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-3 text-xs font-medium text-signal-danger">
          {error}
        </p>
      )}
      <p id={helpId} className="mt-3 text-xs text-ink-subtle">
        We read their public Sleeper history directly. Nothing changes on
        their account, and looking them up does not notify them.
      </p>
    </form>
  );
}
