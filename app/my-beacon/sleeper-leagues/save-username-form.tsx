"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SaveUsernameForm({ defaultUsername }: { defaultUsername: string }) {
  const router = useRouter();
  const [username, setUsername] = useState(defaultUsername);
  const [status, setStatus] = useState<{ kind: "idle" | "saved" | "error"; message?: string }>({
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
      const { error } = await supabase
        .from("user_preferences")
        .upsert(
          {
            user_id: user.id,
            sleeper_username: cleaned || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "saved" });
        router.refresh();
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mt-6 grid gap-3 rounded-card border border-line bg-surface p-5 md:grid-cols-[1fr_auto]"
    >
      <div>
        <label htmlFor="my-beacon-sleeper" className="block text-sm font-medium">
          Sleeper username
        </label>
        <input
          id="my-beacon-sleeper"
          autoComplete="off"
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
