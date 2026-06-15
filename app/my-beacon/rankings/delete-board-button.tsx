"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Delete a board (and, via ON DELETE CASCADE, all of its player rows). Two-step
 * confirm so a single tap never destroys a board. RLS restricts the delete to
 * the owner.
 */
export function DeleteBoardButton({
  boardId,
  boardName,
}: {
  boardId: string;
  boardName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("user_ranking_boards")
        .delete()
        .eq("id", boardId);
      if (!error) {
        router.refresh();
      } else {
        setConfirming(false);
      }
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete board ${boardName}`}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:h-9 sm:w-9"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label={`Confirm deleting board ${boardName}`}
        className="inline-flex h-11 items-center rounded-card border border-signal-danger/60 bg-signal-danger/10 px-3 text-xs font-semibold text-signal-danger hover:bg-signal-danger/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50 sm:h-9"
      >
        {pending ? "Deleting..." : "Confirm delete"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="inline-flex h-11 items-center rounded-card border border-line px-3 text-xs font-medium text-ink-muted hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:h-9"
      >
        Cancel
      </button>
    </div>
  );
}
