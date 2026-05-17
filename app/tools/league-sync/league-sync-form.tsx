"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { currentNflSeason } from "@/lib/sleeper";

export function LeagueSyncForm({
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
    startTransition(() => router.push(`/tools/league-sync?${params.toString()}`));
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-card border border-line bg-surface p-6 md:grid-cols-[1fr_140px_auto]"
      aria-describedby="league-sync-help"
    >
      <div>
        <label htmlFor="sleeper-username" className="block text-sm font-medium">
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
          className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-sm focus:border-brand-purple focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="season" className="block text-sm font-medium">
          Season
        </label>
        <input
          id="season"
          name="season"
          inputMode="numeric"
          pattern="[0-9]{4}"
          value={season}
          onChange={(event) => setSeason(event.target.value)}
          className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-sm focus:border-brand-purple focus:outline-none"
        />
      </div>
      <div className="md:self-end">
        <button
          type="submit"
          disabled={pending || !username.trim()}
          className="inline-flex h-10 items-center rounded-card bg-beacon px-5 text-sm font-semibold text-black disabled:opacity-50"
        >
          {pending ? "Syncing..." : "Sync leagues"}
        </button>
      </div>
      <p id="league-sync-help" className="md:col-span-3 text-xs text-ink-subtle">
        We never store your username unless you sign in and save it. All requests hit the Sleeper API
        directly.
      </p>
    </form>
  );
}
