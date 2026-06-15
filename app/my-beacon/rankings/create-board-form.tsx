"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  BOARD_SCOPES,
  MAX_BOARD_NAME_LENGTH,
  scopeDescription,
  scopeLabel,
  type BoardScope,
} from "@/lib/ranking-boards";

/**
 * Create a new ranking board, then navigate straight into its editor. Writes
 * go through the browser Supabase client and are gated by the owner-only RLS
 * policy on user_ranking_boards (auth.uid() = user_id).
 */
export function CreateBoardForm() {
  const router = useRouter();
  const nameId = useId();
  const scopeId = useId();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<BoardScope>("overall");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleaned = name.trim();
    if (cleaned.length === 0) {
      setError("Give your board a name.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("You need to be signed in.");
        return;
      }
      const { data, error: insertError } = await supabase
        .from("user_ranking_boards")
        .insert({ user_id: user.id, name: cleaned, scope })
        .select("id")
        .single();
      if (insertError || !data) {
        setError(insertError?.message ?? "Could not create the board.");
        return;
      }
      router.push(`/my-beacon/rankings/${data.id}`);
    });
  };

  return (
    <form
      onSubmit={submit}
      aria-labelledby="create-board-heading"
      className="rounded-card border border-line bg-surface p-5 sm:p-6"
    >
      <h3 id="create-board-heading" className="text-base font-semibold text-ink">
        Start a new board
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        Name it, pick what it covers, then add and order players.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor={nameId} className="block text-sm font-medium text-ink">
            Board name
          </label>
          <input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_BOARD_NAME_LENGTH}
            placeholder="My dynasty SF board"
            autoComplete="off"
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink caret-brand-purple focus:border-brand-purple focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor={scopeId} className="block text-sm font-medium text-ink">
            Covers
          </label>
          <select
            id={scopeId}
            value={scope}
            onChange={(event) => setScope(event.target.value as BoardScope)}
            aria-describedby={`${scopeId}-desc`}
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus:border-brand-purple focus:outline-none sm:w-44"
          >
            {BOARD_SCOPES.map((value) => (
              <option key={value} value={value}>
                {value === "overall" ? "Overall (all positions)" : scopeLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          {pending ? "Creating..." : "Create board"}
        </button>
      </div>
      <p id={`${scopeId}-desc`} className="mt-2 text-xs text-ink-subtle">
        {scopeDescription(scope)}
      </p>
      <div aria-live="polite" className="min-h-[1.25rem]">
        {error && (
          <p role="alert" className="mt-2 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
