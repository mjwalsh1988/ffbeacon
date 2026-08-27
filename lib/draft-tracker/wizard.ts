/**
 * The Draft Tracker setup wizard: which questions get asked, in what order, and
 * how an answered one reads back. Pure, browser-safe, no clock and no network.
 *
 * WHY ONE QUESTION AT A TIME. All four on one screen was a wall of controls
 * before the reader had done anything, and the first thing a new page should
 * say is what to do, not everything it could ask. Answered questions collapse
 * into a summary the reader can go back and edit, so at any moment there is one
 * question in front of them and a settled list behind them.
 *
 * WHY FORMAT COMES FIRST. It decides which source actually backs the values,
 * and the ordering question names that source in its own options. Asking the
 * other way round meant the ordering step could name a source the board would
 * not end up using.
 *
 * THE ROOM STEP ONLY EXISTS FOR ONE ANSWER. Somebody tracking their own team
 * has no room to describe, so the step list is derived from the tracking answer
 * rather than fixed, and the step count in the copy follows it.
 */

import { orderLabel } from "./order";
import type { DraftOrder, TrackingMode } from "./types";

export type WizardStepId = "format" | "order" | "tracking" | "room" | "name";

/** Everything the wizard collects. Mirrors what createTracker takes. */
export type WizardDraft = {
  formatSlug: string;
  orderBy: DraftOrder;
  trackingMode: TrackingMode;
  /** Held as text while typing: see the note in the wizard component. */
  teamCountText: string;
  myTeamSlot: number;
  teamNames: string[];
  name: string;
};

export function emptyWizardDraft(formatSlug: string): WizardDraft {
  return {
    formatSlug,
    orderBy: "value",
    trackingMode: "mine",
    teamCountText: "12",
    myTeamSlot: 0,
    teamNames: [],
    name: "",
  };
}

/**
 * The steps, in the order they are asked. The same five whichever way the
 * reader answers the tracking question.
 *
 * The room step used to be skipped for somebody tracking only their own team,
 * on the grounds that they had no room to describe. They do: the size of the
 * room is what turns a pick's position in the list into a draft slot, so
 * "1.01, 1.05, 2.01" needs the team count whether or not the other eleven
 * managers are being tracked by name. What that answer skips instead is which
 * seat is theirs and what everyone is called, which genuinely only matter when
 * every roster is being followed.
 */
export function wizardSteps(_mode: TrackingMode): WizardStepId[] {
  return ["format", "order", "tracking", "room", "name"];
}

/** The question a step asks, used as that step's heading. */
export const STEP_QUESTION: Record<WizardStepId, string> = {
  format: "What rules is the draft using?",
  order: "How should the players be ordered?",
  tracking: "What do you want to keep track of?",
  room: "How big is the draft?",
  name: "What should we call this draft?",
};

/** The short label the summary card uses for a settled answer. */
export const STEP_LABEL: Record<WizardStepId, string> = {
  format: "Rules",
  order: "Order",
  tracking: "Tracking",
  room: "Room",
  name: "Name",
};

export const TRACKING_TITLE: Record<TrackingMode, string> = {
  mine: "Just my team",
  all: "Every team",
};

export const TRACKING_BODY: Record<TrackingMode, string> = {
  mine: "Everyone else's picks come straight off the list. Fastest way to draft.",
  all: "You say who took each player, and you can compare all the rosters as you go.",
};

/** The name a draft gets when the reader leaves the box empty. */
export const DEFAULT_DRAFT_NAME = "My draft";

/**
 * How a settled answer reads in the summary card and on the board afterwards.
 * `teamLabelFor` is passed in rather than imported so this stays free of the
 * team-name coercion rules.
 */
export function describeAnswer(
  step: WizardStepId,
  draft: WizardDraft,
  context: {
    formatLabel: string;
    sourceLabel: string;
    teamCount: number;
    teamLabelFor: (slot: number) => string;
  },
): string {
  switch (step) {
    case "format":
      return context.formatLabel;
    case "order":
      return orderLabel(draft.orderBy, context.sourceLabel);
    case "tracking":
      return TRACKING_TITLE[draft.trackingMode];
    case "room":
      return draft.trackingMode === "all"
        ? `${context.teamCount} teams, you are ${context.teamLabelFor(draft.myTeamSlot)}`
        : `${context.teamCount} teams`;
    case "name":
      return draft.name.trim() || DEFAULT_DRAFT_NAME;
  }
}

/** Where an unfinished setup is kept so closing the page does not lose it. */
export const WIZARD_STORAGE_KEY = "ffbeacon.draft-tracker.setup";

/**
 * Rebuild a saved setup from whatever is in storage.
 *
 * Every field is checked rather than cast. This is the one input to the wizard
 * that did not come from the wizard: it can be old, hand-edited, or written by a
 * version of this code that asked different questions, and none of those should
 * put the reader in front of a broken form. Anything unrecognised falls back to
 * the default for that field, and a format that no longer exists falls back to
 * the caller's default rather than leaving the board pointed at nothing.
 */
export function parseWizardDraft(
  raw: unknown,
  options: { validFormatSlugs: string[]; fallbackFormatSlug: string },
): WizardDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const formatSlug =
    typeof value.formatSlug === "string" && options.validFormatSlugs.includes(value.formatSlug)
      ? value.formatSlug
      : options.fallbackFormatSlug;

  const orderBy: DraftOrder =
    value.orderBy === "adp" || value.orderBy === "alphabetical" || value.orderBy === "value"
      ? value.orderBy
      : "value";

  const trackingMode: TrackingMode = value.trackingMode === "all" ? "all" : "mine";

  const teamCountText =
    typeof value.teamCountText === "string" && /^\d{1,3}$/.test(value.teamCountText)
      ? value.teamCountText
      : "12";

  const myTeamSlot =
    typeof value.myTeamSlot === "number" && Number.isInteger(value.myTeamSlot) && value.myTeamSlot >= 0
      ? value.myTeamSlot
      : 0;

  const teamNames = Array.isArray(value.teamNames)
    ? value.teamNames.slice(0, 32).map((entry) => (typeof entry === "string" ? entry : ""))
    : [];

  const name = typeof value.name === "string" ? value.name.slice(0, 80) : "";

  return { formatSlug, orderBy, trackingMode, teamCountText, myTeamSlot, teamNames, name };
}

/** True when a restored setup actually holds something worth restoring. */
export function isStartedDraft(draft: WizardDraft, defaultFormatSlug: string): boolean {
  return (
    draft.formatSlug !== defaultFormatSlug ||
    draft.orderBy !== "value" ||
    draft.trackingMode !== "mine" ||
    draft.name.trim() !== "" ||
    draft.teamNames.some((n) => n.trim() !== "") ||
    draft.teamCountText !== "12" ||
    draft.myTeamSlot !== 0
  );
}

/** "Step 2 of 4", with the step's own question, for the live region. */
export function describeStepPosition(
  step: WizardStepId,
  steps: WizardStepId[],
): string {
  const index = steps.indexOf(step);
  if (index < 0) return STEP_QUESTION[step];
  return `Step ${index + 1} of ${steps.length}. ${STEP_QUESTION[step]}`;
}
