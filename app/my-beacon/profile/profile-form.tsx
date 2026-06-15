"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  mergeSleeperLeagueSettings,
  parseSleeperLeagueSettings,
} from "@/lib/sleeper-league-settings";

const MAX_NAME = 80;
const MAX_BIO = 2000;

/**
 * Edit-profile form. Display name is written to the auth user (user_metadata),
 * everything else to the owner's user_preferences row. The Sleeper username is
 * merged into the existing sleeper_league_settings jsonb so sibling keys
 * (featured/shown league ids) are never clobbered. All writes are gated by the
 * owner-only RLS policies on user_preferences.
 */
export function ProfileForm({
  initialFirstName,
  initialLastName,
  initialDisplayName,
  initialSleeperUsername,
  initialBio,
}: {
  initialFirstName: string;
  initialLastName: string;
  initialDisplayName: string;
  initialSleeperUsername: string;
  initialBio: string;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [sleeperUsername, setSleeperUsername] = useState(initialSleeperUsername);
  const [bio, setBio] = useState(initialBio);
  const [status, setStatus] = useState<
    { kind: "idle" | "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const firstId = useId();
  const lastId = useId();
  const displayId = useId();
  const sleeperId = useId();
  const bioId = useId();
  const statusId = useId();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setStatus({ kind: "error", message: "You need to be signed in." });
        return;
      }

      // 1) Display name lives on the auth user, not our table.
      const { error: authError } = await supabase.auth.updateUser({
        data: { display_name: displayName.trim() },
      });
      if (authError) {
        setStatus({ kind: "error", message: authError.message });
        return;
      }

      // 2) Read-merge-write the sleeper settings so we don't clobber other keys.
      const { data: existing } = await supabase
        .from("user_preferences")
        .select("sleeper_league_settings")
        .eq("user_id", user.id)
        .maybeSingle();
      const cleanedSleeper = sleeperUsername.trim();
      const nextSettings = mergeSleeperLeagueSettings(
        parseSleeperLeagueSettings(existing?.sleeper_league_settings),
        { username: cleanedSleeper.length > 0 ? cleanedSleeper : null },
      );

      const cleanedFirst = firstName.trim();
      const cleanedLast = lastName.trim();
      const cleanedBio = bio.trim();

      const { error: prefsError } = await supabase
        .from("user_preferences")
        .upsert(
          {
            user_id: user.id,
            first_name: cleanedFirst.length > 0 ? cleanedFirst : null,
            last_name: cleanedLast.length > 0 ? cleanedLast : null,
            bio: cleanedBio.length > 0 ? cleanedBio : null,
            sleeper_league_settings: nextSettings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      if (prefsError) {
        setStatus({ kind: "error", message: prefsError.message });
        return;
      }

      setStatus({ kind: "saved" });
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-6 rounded-card border border-line bg-surface p-5 sm:p-6"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={firstId}
          label="First name"
          value={firstName}
          onChange={setFirstName}
          maxLength={MAX_NAME}
          autoComplete="given-name"
        />
        <Field
          id={lastId}
          label="Last name"
          value={lastName}
          onChange={setLastName}
          maxLength={MAX_NAME}
          autoComplete="family-name"
        />
      </div>

      <Field
        id={displayId}
        label="Display name"
        value={displayName}
        onChange={setDisplayName}
        maxLength={MAX_NAME}
        autoComplete="nickname"
        hint="Shown publicly. This updates the display name on your account."
      />

      <Field
        id={sleeperId}
        label="Sleeper username"
        value={sleeperUsername}
        onChange={setSleeperUsername}
        maxLength={MAX_NAME}
        autoComplete="off"
        hint="Used to sync your Sleeper leagues. Same handle as My Sleeper Leagues."
      />

      <div>
        <label htmlFor={bioId} className="block text-sm font-medium text-ink">
          Bio
        </label>
        <textarea
          id={bioId}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={MAX_BIO}
          rows={4}
          placeholder="A sentence or two about you and how you play."
          className="mt-2 w-full resize-y rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none sm:text-sm"
        />
        <p className="mt-1 text-xs text-ink-subtle">
          {bio.trim().length}/{MAX_BIO} characters.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {pending ? "Saving..." : "Save profile"}
        </button>
        <div
          id={statusId}
          aria-live="polite"
          role="status"
          className="min-h-[1.25rem] text-sm"
        >
          {status.kind === "saved" && (
            <p className="text-signal-success">Profile saved.</p>
          )}
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

function Field({
  id,
  label,
  value,
  onChange,
  maxLength,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  autoComplete: string;
  hint?: string;
}) {
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none sm:text-sm"
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
