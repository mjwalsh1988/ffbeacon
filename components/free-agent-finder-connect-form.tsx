"use client";

import { SaveHandleForm } from "@/components/sleeper-handle/save-handle-form";
import { FOCUS_AFTER_SAVE_KEY } from "@/components/free-agent-finder-panel";

/**
 * The Sleeper username form on the Free Agent Finder page.
 *
 * Saving refreshes the page, which unmounts this form and mounts the search
 * box in its place. Without a hand-off, keyboard focus falls back to the page
 * body and a screen reader user has to hunt for where they are. So the save
 * leaves a one-time flag, and the search box takes focus when it sees it.
 */
export function FreeAgentFinderConnectForm({
  defaultUsername,
  submitLabel,
}: {
  defaultUsername?: string;
  submitLabel: string;
}) {
  return (
    <SaveHandleForm
      defaultUsername={defaultUsername}
      submitLabel={submitLabel}
      onSaved={() => {
        try {
          window.sessionStorage.setItem(FOCUS_AFTER_SAVE_KEY, "1");
        } catch {
          // Storage blocked: the save still works, focus just is not moved.
        }
      }}
    />
  );
}
