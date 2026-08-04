"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  mergeSleeperLeagueSettings,
  parseSleeperLeagueSettings,
} from "@/lib/sleeper-league-settings";

export function SaveUsernameForm({
  defaultUsername,
  autoFocus = false,
  onSaved,
}: {
  defaultUsername: string;
  /** Set when the form was just revealed by a disclosure, so the caret lands in
   *  the field the reader asked for instead of at the top of the page. */
  autoFocus?: boolean;
  /** Fired after a successful save, so a collapsible wrapper can close itself. */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(defaultUsername);
  const [status, setStatus] = useState<{
    kind: "idle" | "saved" | "error";
    message?: string;
  }>({
    kind: "idle",
  });
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleaned = username.trim();
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setStatus({ kind: "error", message: "Not signed in." });
        return;
      }
      // Read-merge-write so we don't clobber other keys in the jsonb
      // (featured_league_id, shown_league_ids, etc.). Read uses the
      // owner-only RLS policy that already gates this row.
      const { data: existing } = await supabase
        .from("user_preferences")
        .select("sleeper_league_settings")
        .eq("user_id", user.id)
        .maybeSingle();
      const current = parseSleeperLeagueSettings(
        existing?.sleeper_league_settings,
      );
      const next = mergeSleeperLeagueSettings(current, {
        username: cleaned.length > 0 ? cleaned : null,
      });
      const { error } = await supabase.from("user_preferences").upsert(
        {
          user_id: user.id,
          sleeper_league_settings: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "saved" });
        router.refresh();
        onSaved?.();
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mt-6 grid gap-3 rounded-card border border-line bg-surface p-5 md:grid-cols-[1fr_auto]"
    >
      <div>
        <label
          htmlFor="my-beacon-sleeper"
          className="block text-sm font-medium"
        >
          Sleeper username
        </label>
        <input
          id="my-beacon-sleeper"
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- only ever true when
          // the reader just pressed the control that revealed this field.
          autoFocus={autoFocus}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="your-handle"
          className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-sm focus:border-brand-purple focus:outline-none"
        />
      </div>
      <div className="md:self-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-card border border-line bg-surface-elevated px-4 text-sm font-medium hover:border-line-accent disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
      <div aria-live="polite" className="md:col-span-2 min-h-[1.25rem] text-sm">
        {status.kind === "saved" && (
          <p className="text-signal-success">Saved. Loading your leagues...</p>
        )}
        {status.kind === "error" && (
          <p className="text-signal-danger" role="alert">
            {status.message}
          </p>
        )}
      </div>
    </form>
  );
}
