"use client";

import type { ReactNode } from "react";
import { SaveHandleNotice } from "@/components/sleeper-handle/save-handle-notice";
import {
  SleeperIdentityCard,
  type IdentityCardStatus,
} from "@/components/sleeper-handle/identity-card";
import type {
  HandleGateState,
  SavedSleeperHandle,
  SleeperViewer,
} from "@/lib/sleeper-handle/types";

/**
 * Which of the three pieces a given state renders.
 *
 * Pure, exported, and tested on its own, so the four states are asserted
 * without standing up a DOM. `card` and `notice` are never both true: the card
 * IS the notice for a reader who already saved a handle.
 */
export type GateRenderPlan = {
  /** The identity card, with the form as its disclosure. */
  card: boolean;
  /** The tool's own form, on screen and unwrapped. */
  form: boolean;
  /** The "save your username" line under the form, and which wording. */
  notice: "guest" | "member-unsaved" | null;
  /** The checkbox default inside the form, when the form is rendered. */
  saveByDefault: boolean;
};

export function gateRenderPlan(state: HandleGateState): GateRenderPlan {
  switch (state.kind) {
    case "guest":
      // No account, so nothing to save into. The checkbox is meaningless here
      // and the notice carries the sign-in link instead.
      return { card: false, form: true, notice: "guest", saveByDefault: false };
    case "member-unsaved":
      // About to type their own handle. Ticked.
      return {
        card: false,
        form: true,
        notice: "member-unsaved",
        saveByDefault: true,
      };
    case "member-saved":
    case "member-overridden":
      // The form still exists, behind Change. Unticked, because the usual
      // reason to open it is a one-off look at somebody else's leagues.
      return { card: true, form: false, notice: null, saveByDefault: false };
  }
}

/**
 * The composer every username surface renders.
 *
 * A tool keeps its own form and its own submit semantics; this decides
 * whether that form is on screen at all, and what sits around it.
 */
export function SleeperHandleGate({
  state,
  toolName,
  nextPath,
  headingLevel = 2,
  status = "idle",
  statusMessage,
  onRetry,
  renderForm,
  manageHref,
  clearHref,
  actions,
  compact = false,
  className,
}: {
  state: HandleGateState;
  toolName: string;
  /** Current path, for the guest notice's sign-in link. */
  nextPath: string;
  headingLevel?: 1 | 2 | 3;
  status?: IdentityCardStatus;
  statusMessage?: string | null;
  onRetry?: () => void;
  renderForm: (ctx: {
    saveByDefault: boolean;
    /** True while the form is inside the card's disclosure. */
    inCard: boolean;
    handle: SavedSleeperHandle | null;
    viewer: SleeperViewer | null;
  }) => ReactNode;
  manageHref?: string;
  clearHref?: string;
  actions?: ReactNode;
  /**
   * Straight through to the card, and meaningless without one.
   *
   * The three formless states render a form rather than a card, and a form has
   * nothing to shrink, so this is deliberately not threaded into that branch.
   */
  compact?: boolean;
  className?: string;
}) {
  const plan = gateRenderPlan(state);
  const handle =
    state.kind === "member-saved" || state.kind === "member-overridden"
      ? state.handle
      : null;
  const viewer = state.kind === "member-overridden" ? state.viewer : null;

  if (plan.card && handle) {
    return (
      <SleeperIdentityCard
        toolName={toolName}
        handle={handle}
        viewer={viewer}
        headingLevel={headingLevel}
        status={status}
        statusMessage={statusMessage}
        onRetry={onRetry}
        manageHref={manageHref}
        clearHref={clearHref}
        actions={actions}
        compact={compact}
        className={className}
      >
        {renderForm({
          saveByDefault: plan.saveByDefault,
          inCard: true,
          handle,
          viewer,
        })}
      </SleeperIdentityCard>
    );
  }

  return (
    <div className={className}>
      {renderForm({
        saveByDefault: plan.saveByDefault,
        inCard: false,
        handle: null,
        viewer: null,
      })}
      {plan.notice && (
        <SaveHandleNotice state={plan.notice} nextPath={nextPath} />
      )}
    </div>
  );
}
