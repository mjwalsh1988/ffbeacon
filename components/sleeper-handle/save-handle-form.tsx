"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSleeperHandle } from "@/app/actions/sleeper-handle";
import {
  INVALID_HANDLE_MESSAGE,
  normalizeSleeperHandle,
} from "@/lib/sleeper-handle/validate";
import type { SavedSleeperHandle } from "@/lib/sleeper-handle/types";

/**
 * The Sleeper username form for the two surfaces where saving is the ONLY
 * thing the form does: `/my-beacon/sleeper-leagues`, which is the settings
 * page, and the Signal Check import panel, whose league list is read from the
 * saved handle server-side so a one-off lookup has nowhere to go.
 *
 * There is deliberately no "inline" mode here and no D5 save checkbox. Every
 * tool that offers a one-off lookup already owns its own form (League Pulse
 * navigates to `?username=`, On The Clock and FAAB and Breakdown each call
 * their own connect action), and each renders the checkbox itself because only
 * it knows what "look this up without saving it" means. A second unreachable
 * copy of that checkbox lived here for a while and was worse than no copy: it
 * read as the shared implementation while the live ones were elsewhere.
 */
export function SaveHandleForm({
  defaultUsername = "",
  autoFocus = false,
  onSaved,
  submitLabel = "Save",
  label = "Sleeper username",
}: {
  defaultUsername?: string;
  /** True only when a disclosure just revealed this form. */
  autoFocus?: boolean;
  onSaved?: (handle: SavedSleeperHandle) => void;
  submitLabel?: string;
  label?: string;
}) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();

  const [username, setUsername] = useState(defaultUsername);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);

    // The same gate the server action runs. Catching it here means a typo
    // costs no round trip and no rate-limit slot.
    const normalized = normalizeSleeperHandle(username);
    if (!normalized) {
      setError(INVALID_HANDLE_MESSAGE);
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await saveSleeperHandle({ username: normalized });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      onSaved?.(result.handle);
      // Every surface that renders an identity reads it during its render.
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <div>
        <label htmlFor={inputId} className="block text-sm font-medium text-ink">
          {label}
        </label>
        <input
          id={inputId}
          name="sleeper_username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- only ever true
          // when the reader just pressed the control that revealed this field.
          autoFocus={autoFocus}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="your-handle"
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus:border-brand-purple focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        />
      </div>

      <div className="sm:self-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 min-h-11 w-full items-center justify-center rounded-card border border-brand-purple/40 bg-brand-purple/10 px-4 text-sm font-medium text-ink transition-colors hover:border-brand-purple disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
        >
          {pending ? "Saving..." : submitLabel}
        </button>
      </div>

      <div aria-live="polite" className="min-h-[1.25rem] text-sm sm:col-span-2">
        {saved && <p className="text-signal-success">Saved.</p>}
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-signal-danger sm:col-span-2"
        >
          {error}
        </p>
      )}
    </form>
  );
}
