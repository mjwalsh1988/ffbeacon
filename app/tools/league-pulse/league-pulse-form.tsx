"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { currentNflSeason } from "@/lib/nfl-season";
import { saveSleeperHandle } from "@/app/actions/sleeper-handle";
import {
  INVALID_HANDLE_MESSAGE,
  normalizeSleeperHandle,
} from "@/lib/sleeper-handle/validate";

/**
 * The League Pulse lookup form.
 *
 * It still owns its own submit semantics: a search is a navigation to
 * `?username=`, so the result is a real page a reader can share, bookmark and
 * come back to. What the saved-handle work adds is the D5 checkbox, and one
 * ordering rule that matters.
 *
 * THE SAVE RUNS BEFORE THE NAVIGATION. If the URL changed first, the page
 * would re-render against the OLD saved handle and the card would name a
 * different reader than the results underneath it, for one paint, on the one
 * screen where that gap is the whole point of the feature.
 *
 * A FAILED SAVE STILL SEARCHES. The lookup does not depend on the save, and
 * refusing to show a reader their leagues because a rate limit fired would be
 * punishing them for a decision the checkbox made. The alert says the search
 * ran and the handle was not saved, rather than leaving them to guess which
 * half happened.
 */

export function LeaguePulseForm({
  defaultUsername,
  defaultSeason,
  saveByDefault = false,
  showSaveOption = false,
}: {
  defaultUsername: string;
  defaultSeason: string;
  /** The checkbox's initial state, decided by the gate (D5). */
  saveByDefault?: boolean;
  /** False for a signed-out reader: there is no account to save into. */
  showSaveOption?: boolean;
}) {
  const router = useRouter();
  const errorId = useId();
  const checkboxId = useId();
  const [username, setUsername] = useState(defaultUsername);
  const [season, setSeason] = useState(defaultSeason || currentNflSeason());
  const [save, setSave] = useState(saveByDefault);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // The same gate the server action runs, so a typo costs no round trip and
    // no rate-limit slot. Normalizing also means the URL and the saved handle
    // are the same string.
    const normalized = normalizeSleeperHandle(username);
    if (!normalized) {
      setError(INVALID_HANDLE_MESSAGE);
      return;
    }
    setError(null);
    setSaveError(null);

    const params = new URLSearchParams({ username: normalized, season });
    // scroll: false stops the App Router from snapping back to the top after the
    // navigation. ScrollToResults then owns the scroll so the user is taken to
    // their leagues on every search, not just on a hard refresh.
    startTransition(async () => {
      if (showSaveOption && save) {
        const result = await saveSleeperHandle({ username: normalized });
        if (!result.ok) {
          setSaveError(
            `${result.error} We loaded the leagues for ${normalized} anyway, but the handle was not saved.`,
          );
        }
      }
      router.push(`/tools/league-pulse?${params.toString()}`, {
        scroll: false,
      });
    });
  };

  return (
    <form
      onSubmit={submit}
      className="relative overflow-hidden rounded-modal border border-brand-purple/30 bg-surface p-5 sm:p-6"
      aria-describedby="league-pulse-help"
      style={{
        boxShadow: "0 0 90px -36px rgba(168, 85, 247, 0.55)",
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.10) 0%, transparent 55%)",
      }}
    >
      {/* Top-edge gradient accent, same treatment as the login card so the
          primary action surface reads consistently across the site. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      <div className="grid gap-4 md:grid-cols-[1fr_140px_auto]">
        <div>
          <label htmlFor="sleeper-username" className="block text-sm font-medium text-ink">
            Sleeper username
          </label>
          <input
            id="sleeper-username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="your-sleeper-handle"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
          />
        </div>
        <div>
          <label htmlFor="season" className="block text-sm font-medium text-ink">
            Season
          </label>
          <input
            id="season"
            name="season"
            inputMode="numeric"
            pattern="[0-9]{4}"
            value={season}
            onChange={(event) => setSeason(event.target.value)}
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm font-mono tabular-nums focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
          />
        </div>
        <div className="md:self-end">
          <button
            type="submit"
            disabled={pending || !username.trim()}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:w-auto"
          >
            <Search aria-hidden="true" className="h-3.5 w-3.5" />
            {pending ? "Searching..." : "Find leagues"}
          </button>
        </div>
      </div>

      {showSaveOption && (
        // The row is 44 px tall and the label is part of the target, so the
        // checkbox itself never has to be hit at 16 px.
        <div className="mt-4 flex min-h-11 items-center gap-2.5">
          <input
            id={checkboxId}
            type="checkbox"
            checked={save}
            onChange={(event) => setSave(event.target.checked)}
            className="h-4 w-4 shrink-0 rounded border-line bg-base text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
          <label
            htmlFor={checkboxId}
            className="flex min-h-11 items-center text-sm text-ink-muted"
          >
            Save this as my Sleeper username
          </label>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="mt-3 text-sm text-signal-danger">
          {error}
        </p>
      )}

      {saveError && (
        <p role="alert" className="mt-3 text-sm text-signal-danger">
          {saveError}
        </p>
      )}

      <p id="league-pulse-help" className="mt-4 text-xs text-ink-subtle">
        Your username is never stored unless you save it. All requests hit the
        Sleeper API directly.
      </p>
    </form>
  );
}
