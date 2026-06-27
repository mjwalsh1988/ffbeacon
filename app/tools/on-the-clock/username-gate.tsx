"use client";

/**
 * Username entry for On The Clock, styled like the League Pulse form. MOCKED for
 * Phase 4: submitting calls onConnect(username) with no network. Phase 5 swaps the
 * handler for the leagues route fetch.
 */

import { useState } from "react";
import { Search } from "lucide-react";
import { ErrorCard } from "./states";

export function UsernameGate({
  defaultUsername = "",
  defaultSeason,
  onConnect,
  pending = false,
  error = null,
}: {
  defaultUsername?: string;
  defaultSeason: string;
  onConnect: (username: string, season: string) => void;
  pending?: boolean;
  /** Lookup error to surface above the help text (e.g. user not found, throttled). */
  error?: string | null;
}) {
  const [username, setUsername] = useState(defaultUsername);
  const [season, setSeason] = useState(defaultSeason);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim()) return;
    onConnect(username.trim(), season.trim() || defaultSeason);
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
            autoComplete="off"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your-sleeper-handle"
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
            disabled={pending || !username.trim()}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan md:w-auto"
          >
            <Search aria-hidden="true" className="h-3.5 w-3.5" />
            {pending ? "Finding..." : "Find active drafts"}
          </button>
        </div>
      </div>
      {error && (
        <div className="mt-4">
          <ErrorCard message={error} />
        </div>
      )}
      <p id="otc-username-help" className="mt-4 text-xs text-ink-subtle">
        We only show leagues that are actively drafting. Your username is never
        stored unless you sign in and save it.
      </p>
    </form>
  );
}
