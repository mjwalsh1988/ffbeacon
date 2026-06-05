"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { currentNflSeason } from "@/lib/sleeper";

export function LeaguePulseForm({
  defaultUsername,
  defaultSeason,
}: {
  defaultUsername: string;
  defaultSeason: string;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(defaultUsername);
  const [season, setSeason] = useState(defaultSeason || currentNflSeason());
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim()) return;
    const params = new URLSearchParams({ username: username.trim(), season });
    startTransition(() => router.push(`/tools/league-pulse?${params.toString()}`));
  };

  return (
    <form
      onSubmit={submit}
      className="relative overflow-hidden rounded-modal border border-line bg-surface p-5 sm:p-6"
      aria-describedby="league-pulse-help"
      style={{
        boxShadow: "0 0 64px -32px rgba(168, 85, 247, 0.35)",
      }}
    >
      {/* Top-edge gradient accent — same treatment as the login card so the
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
            autoComplete="off"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="your-sleeper-handle"
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
      <p id="league-pulse-help" className="mt-4 text-xs text-ink-subtle">
        We never store your username unless you sign in and save it. All
        requests hit the Sleeper API directly.
      </p>
    </form>
  );
}
