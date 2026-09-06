"use client";

/**
 * Username entry for On The Clock, styled like the League Pulse form.
 *
 * Two things sit on top of the plain lookup it started as:
 *
 *   The handle is validated here, with the same pure gate the server action
 *   runs, so a typo costs no round trip and no rate-limit slot. The message is
 *   `role="alert"` and is named by the input through `aria-describedby`, which
 *   is what makes it reachable from the field a reader is sitting in rather
 *   than only visible under the form.
 *
 *   The save box (D5) is rendered only when the caller passes
 *   `showSaveOption`, which is the gate's way of saying this reader has an
 *   account to save into. Ticked, the handle is saved BEFORE the lookup runs,
 *   so the saved identity and the leagues on screen can never disagree. It is
 *   unticked by default while a handle is already saved, because the usual
 *   reason to open this form again is a one-off look at a leaguemate's drafts.
 *
 * The help line no longer promises that nothing is stored. The notice the gate
 * renders under this form says what saving is and links to it, which is the
 * same sentence with somewhere to go.
 */

import { useId, useState } from "react";
import { Search } from "lucide-react";
import { saveSleeperHandle } from "@/app/actions/sleeper-handle";
import {
  INVALID_HANDLE_MESSAGE,
  normalizeSleeperHandle,
} from "@/lib/sleeper-handle/validate";
import { ErrorCard } from "./states";

export function UsernameGate({
  defaultUsername = "",
  defaultSeason,
  onConnect,
  pending = false,
  error = null,
  saveByDefault = false,
  showSaveOption = false,
}: {
  defaultUsername?: string;
  defaultSeason: string;
  onConnect: (username: string, season: string) => void;
  pending?: boolean;
  /** Lookup error to surface above the help text (e.g. user not found, throttled). */
  error?: string | null;
  /** The save box's initial state. Ignored while `showSaveOption` is false. */
  saveByDefault?: boolean;
  /** True only for a signed-in reader, who has somewhere to save a handle. */
  showSaveOption?: boolean;
}) {
  const [username, setUsername] = useState(defaultUsername);
  const [season, setSeason] = useState(defaultSeason);
  const [save, setSave] = useState(saveByDefault);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const errorId = useId();
  const saveId = useId();
  const busy = pending || saving;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const normalized = normalizeSleeperHandle(username);
    if (!normalized) {
      setFormError(INVALID_HANDLE_MESSAGE);
      return;
    }
    setFormError(null);

    const nextSeason = season.trim() || defaultSeason;

    // Saving first is deliberate. A save that fails after the leagues load
    // leaves a reader looking at the right list under the wrong identity, and
    // the next visit would quietly disagree with this one.
    if (showSaveOption && save) {
      setSaving(true);
      const result = await saveSleeperHandle({ username: normalized });
      setSaving(false);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
    }

    onConnect(normalized, nextSeason);
  };

  return (
    <form
      onSubmit={submit}
      aria-describedby="otc-username-help"
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
      <div className="grid gap-4 md:grid-cols-[1fr_140px_auto]">
        <div>
          <label htmlFor="otc-username" className="block text-sm font-medium text-ink">
            Sleeper username
          </label>
          <input
            id="otc-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your-sleeper-handle"
            aria-describedby={formError ? errorId : undefined}
            aria-invalid={formError ? true : undefined}
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
          />
        </div>
        <div>
          <label htmlFor="otc-season" className="block text-sm font-medium text-ink">
            Season
          </label>
          <input
            id="otc-season"
            name="season"
            inputMode="numeric"
            pattern="[0-9]{4}"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm font-mono tabular-nums focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
          />
        </div>
        <div className="md:self-end">
          <button
            type="submit"
            disabled={busy || !username.trim()}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:w-auto"
          >
            <Search aria-hidden="true" className="h-3.5 w-3.5" />
            {saving ? "Saving..." : pending ? "Finding..." : "Find my drafts"}
          </button>
        </div>
      </div>

      {showSaveOption && (
        // The label wraps the box so the whole 44px row toggles it, which is
        // the only way a 16px checkbox reaches the tap-target minimum.
        <label
          htmlFor={saveId}
          className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-2.5 py-2 text-sm text-ink-muted"
        >
          <input
            id={saveId}
            type="checkbox"
            checked={save}
            onChange={(e) => setSave(e.target.checked)}
            className="h-4 w-4 shrink-0 rounded border-line bg-base text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          />
          Save this as my Sleeper username
        </label>
      )}

      {formError && (
        <p id={errorId} role="alert" className="mt-4 text-sm text-signal-danger">
          {formError}
        </p>
      )}

      {error && (
        <div className="mt-4">
          <ErrorCard message={error} />
        </div>
      )}
      <p id="otc-username-help" className="mt-4 text-xs text-ink-subtle">
        We show every league with a draft, grouped by drafting now, pre-draft, and
        completed.
      </p>
    </form>
  );
}
