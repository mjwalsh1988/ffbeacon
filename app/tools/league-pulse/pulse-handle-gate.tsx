"use client";

import { SleeperHandleGate } from "@/components/sleeper-handle/handle-gate";
import type { IdentityCardStatus } from "@/components/sleeper-handle/identity-card";
import type { HandleGateState } from "@/lib/sleeper-handle/types";
import { LeaguePulseForm } from "./league-pulse-form";

/**
 * The League Pulse cockpit's half of the shared handle gate.
 *
 * `SleeperHandleGate` takes a `renderForm` FUNCTION, and `page.tsx` is a
 * server component, so it cannot hand one over: a function is not
 * serializable across that boundary. This file exists for exactly that seam.
 * It takes plain values, and does the `renderForm` wiring on the client, where
 * a function prop is ordinary.
 *
 * It adds no state and makes no decision the gate does not already own. The
 * one judgement here is `showSaveOption`, and it is D5 plus D6: a signed-in
 * reader gets the "Save this as my Sleeper username" checkbox whether the form
 * is on screen (member-unsaved, box ticked) or behind Change on the card
 * (member-saved, box unticked), because the D6 notice under the form points at
 * that checkbox rather than at another page. A signed-out reader gets no
 * checkbox: there is no account to save into, and the notice carries the
 * sign-in link instead.
 */
export function PulseHandleGate({
  state,
  defaultUsername,
  defaultSeason,
  status = "idle",
  statusMessage,
  clearHref,
  compact = false,
}: {
  state: HandleGateState;
  /** The handle this visit is acting for, prefilled outside the card. */
  defaultUsername: string;
  defaultSeason: string;
  status?: IdentityCardStatus;
  statusMessage?: string | null;
  /** Where "Switch to your saved handle" goes, when a link overrode it. */
  clearHref?: string;
  /**
   * True on the two states that render the card, where the page has dropped
   * the cockpit around it and the card is a status line above the leagues
   * rather than the thing the reader came for.
   */
  compact?: boolean;
}) {
  return (
    <SleeperHandleGate
      // 3, not the default 2: this renders inside the section whose own
      // heading is the h2 "Your Sleeper account", so a second h2 here would
      // read as its sibling rather than its child. FAAB, Breakdown and On
      // The Clock all pass 3 under their own h2 for the same reason.
      headingLevel={3}
      state={state}
      toolName="League Pulse"
      nextPath="/tools/league-pulse"
      status={status}
      statusMessage={statusMessage}
      clearHref={clearHref}
      compact={compact}
      renderForm={({ saveByDefault, inCard }) => (
        <LeaguePulseForm
          // Inside the card the field starts empty on purpose. The reader
          // already sees whose leagues they are looking at in the heading
          // above it, and the usual reason to press Change is to look at
          // somebody else's leagues once (D5).
          defaultUsername={inCard ? "" : defaultUsername}
          defaultSeason={defaultSeason}
          saveByDefault={saveByDefault}
          showSaveOption={state.kind !== "guest"}
        />
      )}
    />
  );
}
