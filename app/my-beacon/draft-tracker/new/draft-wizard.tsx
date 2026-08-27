"use client";

/**
 * Setting up a draft, one question at a time.
 *
 * The reader sees exactly one question, the answers they have already given as a
 * short settled list above it, and two buttons. Nothing else. The previous
 * version put all four questions on one screen, which is a wall of controls
 * before anybody has done anything.
 *
 * AN ANSWER IS NEVER STUCK. Every settled row in the summary has an Edit button
 * that jumps straight back to that question and returns to where the reader was.
 * "Chosen is chosen" is about the screen being calm, not about the answers being
 * locked.
 *
 * NOTHING AUTO-ADVANCES. Choosing an option and moving on are separate presses.
 * Auto-advancing on selection saves a tap and costs the reader the moment where
 * they change their mind, and by ear it means the next question starts talking
 * over the confirmation of the last answer.
 *
 * IT SURVIVES THE PAGE CLOSING. Progress is written to localStorage on every
 * change and read back on the next visit, so a phone that locks mid-setup does
 * not cost the reader their answers. It is cleared the moment the draft is
 * created, and there is a visible way to throw it away.
 *
 * FOCUS AND ANNOUNCEMENT. Moving between steps swaps the whole question out, so
 * focus is moved to the new step's heading and a polite region reads "Step 3 of
 * 5" plus the question. Without that a screen reader is left on a button that no
 * longer exists and told nothing about what replaced it.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronDown, Pencil, Play, RotateCcw } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import {
  DRAFT_ORDERS,
  clampTeamCount,
  orderHelp,
  orderLabel,
  teamLabel,
} from "@/lib/draft-tracker/order";
import {
  DEFAULT_DRAFT_NAME,
  STEP_LABEL,
  STEP_QUESTION,
  TRACKING_BODY,
  TRACKING_TITLE,
  WIZARD_STORAGE_KEY,
  describeAnswer,
  describeStepPosition,
  emptyWizardDraft,
  isStartedDraft,
  parseWizardDraft,
  wizardSteps,
  type WizardDraft,
  type WizardStepId,
} from "@/lib/draft-tracker/wizard";
import {
  MAX_TEAMS,
  MAX_TEAM_NAME_LENGTH,
  MIN_TEAMS,
  type DraftOrder,
  type TrackingMode,
} from "@/lib/draft-tracker/types";
import { createTracker } from "../actions";

export type FormatChoice = { slug: string; label: string };

const PANEL_ID = "draft-setup-step";

export function DraftWizard({
  formats,
  defaultFormatSlug,
  sourceLabelByFormat,
}: {
  formats: FormatChoice[];
  defaultFormatSlug: string;
  /**
   * The source that actually backs each format's values, so the ordering step
   * never names a source the board will not use.
   */
  sourceLabelByFormat: Record<string, string>;
}) {
  const router = useRouter();
  const formatId = useId();
  const countId = useId();
  const mySlotId = useId();
  const namesId = useId();
  const nameId = useId();

  const [draft, setDraft] = useState<WizardDraft>(() => emptyWizardDraft(defaultFormatSlug));
  const [stepId, setStepId] = useState<WizardStepId>("format");
  // Which questions the reader has actually been in front of. Tracked as a set
  // of ids rather than a furthest index, because the step LIST itself changes
  // when the tracking answer changes, and an index into a list that grew or
  // shrank would start naming the wrong question.
  const [visited, setVisited] = useState<Set<WizardStepId>>(() => new Set(["format"]));
  const [namesOpen, setNamesOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const steps = wizardSteps(draft.trackingMode);
  const stepIndex = Math.max(0, steps.indexOf(stepId));
  const isLastStep = stepIndex === steps.length - 1;
  // Everything the reader has answered, minus the one they are looking at. Going
  // back to change an early answer should not make the later ones disappear.
  const settled = steps.filter((id) => id !== stepId && visited.has(id));

  const teamCount = clampTeamCount(draft.teamCountText);
  const slots = useMemo(() => Array.from({ length: teamCount }, (_, i) => i), [teamCount]);
  const formatLabel =
    formats.find((f) => f.slug === draft.formatSlug)?.label ?? draft.formatSlug;
  const sourceLabel = sourceLabelByFormat[draft.formatSlug] ?? "your source";

  const patch = useCallback((next: Partial<WizardDraft>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  }, []);

  // --- restore, save, discard --------------------------------------------
  const hydrated = useRef(false);
  useEffect(() => {
    hydrated.current = true;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(WIZARD_STORAGE_KEY);
    } catch {
      return; // private mode, storage disabled: setting up fresh is fine
    }
    if (!raw) return;
    let parsed: WizardDraft | null = null;
    try {
      parsed = parseWizardDraft(JSON.parse(raw), {
        validFormatSlugs: formats.map((f) => f.slug),
        fallbackFormatSlug: defaultFormatSlug,
      });
    } catch {
      return;
    }
    if (!parsed || !isStartedDraft(parsed, defaultFormatSlug)) return;
    setDraft(parsed);
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore runs once
  }, []);

  useEffect(() => {
    // Do not write on the very first render, or an empty draft would overwrite
    // the saved one before the restore above has had a chance to read it.
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Nothing to do. Losing the saved copy is not worth failing the setup over.
    }
  }, [draft]);

  const clearSaved = useCallback(() => {
    try {
      window.localStorage.removeItem(WIZARD_STORAGE_KEY);
    } catch {
      // Same again: best effort.
    }
  }, []);

  const startOver = () => {
    clearSaved();
    setDraft(emptyWizardDraft(defaultFormatSlug));
    setStepId("format");
    setVisited(new Set(["format"]));
    setRestored(false);
    setNamesOpen(false);
    setError(null);
    setAnnouncement("Setup cleared. Back to the first question.");
  };

  // --- moving between steps ----------------------------------------------
  const movedRef = useRef(false);
  const goTo = useCallback((next: WizardStepId) => {
    movedRef.current = true;
    setStepId(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    setError(null);
  }, []);

  useEffect(() => {
    if (!movedRef.current) return;
    movedRef.current = false;
    setAnnouncement(describeStepPosition(stepId, steps));
    // The question the reader was on has been replaced, so focus has to be put
    // somewhere deliberate rather than left on a button that no longer exists.
    document.getElementById(`${PANEL_ID}-title`)?.focus();
  }, [stepId, steps]);

  const goNext = () => {
    if (isLastStep) return;
    goTo(steps[stepIndex + 1]);
  };

  const goBack = () => {
    if (stepIndex === 0) return;
    goTo(steps[stepIndex - 1]);
  };

  const setTeamName = (slot: number, value: string) => {
    setDraft((prev) => {
      const names = prev.teamNames.slice();
      while (names.length < slot + 1) names.push("");
      names[slot] = value;
      return { ...prev, teamNames: names };
    });
  };

  /** Settle the typed count and keep the reader's own slot inside the room. */
  const commitTeamCount = () => {
    const settledCount = clampTeamCount(draft.teamCountText);
    setDraft((prev) => ({
      ...prev,
      teamCountText: String(settledCount),
      myTeamSlot: Math.min(prev.myTeamSlot, settledCount - 1),
    }));
  };

  const submit = () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const settledCount = clampTeamCount(draft.teamCountText);
    void (async () => {
      const result = await createTracker({
        name: draft.name,
        formatSlug: draft.formatSlug,
        orderBy: draft.orderBy,
        trackingMode: draft.trackingMode,
        teamCount: settledCount,
        myTeamSlot: Math.min(draft.myTeamSlot, settledCount - 1),
        teamNames: draft.teamNames,
      });
      if (!result.ok) {
        setSubmitting(false);
        setError(result.error);
        return;
      }
      clearSaved();
      if (result.id) router.push(`/my-beacon/draft-tracker/${result.id}`);
    })();
  };

  // Nothing to draft from means nothing to set up.
  if (formats.length === 0) {
    return (
      <Panel eyebrow="New draft" title="No formats are available right now." headingLevel={2}>
        <p className="text-sm leading-relaxed text-ink-muted">
          A draft board needs a set of scoring rules to price players against, and
          none are published at the moment. This is on our side, not yours. Try
          again shortly.
        </p>
      </Panel>
    );
  }

  const inputClass =
    "h-11 w-full rounded-card border border-line bg-base px-3 text-base text-ink caret-brand-purple focus:border-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:text-sm";

  const optionClass = (active: boolean, accent: "cyan" | "purple") =>
    `min-h-11 w-full rounded-card border px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
      active
        ? accent === "cyan"
          ? "border-brand-cyan/60 bg-brand-cyan/10"
          : "border-brand-purple/60 bg-brand-purple/10"
        : "border-line bg-base hover:border-line-accent"
    }`;

  return (
    <div className="space-y-4">
      {restored && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-brand-cyan/40 bg-brand-cyan/10 px-4 py-3">
          <p className="text-sm text-ink">
            Picked up where you left off. Nothing has been created yet.
          </p>
          <button
            type="button"
            onClick={startOver}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Start over
          </button>
        </div>
      )}

      {/* The answers so far. Empty on the first question, so it draws nothing. */}
      {settled.length > 0 && (
        <Panel eyebrow="Your draft so far" title="Settled" headingLevel={2}>
          <dl className="grid gap-2">
            {settled.map((id) => (
              <div
                key={id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-base/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                    {STEP_LABEL[id]}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-ink">
                    {describeAnswer(id, draft, {
                      formatLabel,
                      sourceLabel,
                      teamCount,
                      teamLabelFor: (slot) => teamLabel(draft.teamNames, slot),
                    })}
                  </dd>
                </div>
                <button
                  type="button"
                  onClick={() => goTo(id)}
                  aria-label={`Change your answer to ${STEP_QUESTION[id].toLowerCase()}`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line px-3 text-xs font-semibold text-ink-muted transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                  Edit
                </button>
              </div>
            ))}
          </dl>
        </Panel>
      )}

      <Panel
        id={PANEL_ID}
        eyebrow={`Step ${stepIndex + 1} of ${steps.length}`}
        title={STEP_QUESTION[stepId]}
        headingLevel={2}
        headingFocusable
        glow
      >
        <p role="status" className="sr-only">
          {announcement}
        </p>

        {stepId === "format" && (
          <div>
            <label htmlFor={formatId} className="sr-only">
              {STEP_QUESTION.format}
            </label>
            <select
              id={formatId}
              value={draft.formatSlug}
              onChange={(event) => patch({ formatSlug: event.target.value })}
              aria-describedby={`${formatId}-help`}
              className={`${inputClass} sm:max-w-sm`}
            >
              {formats.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.label}
                </option>
              ))}
            </select>
            <p id={`${formatId}-help`} className="mt-3 text-sm leading-relaxed text-ink-muted">
              This decides which values and which ADP list we show, so a dynasty
              room is never priced off a redraft market. Values for this format
              come from {sourceLabel}.
            </p>
          </div>
        )}

        {stepId === "order" && (
          <fieldset>
            <legend className="sr-only">{STEP_QUESTION.order}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {DRAFT_ORDERS.map((value: DraftOrder) => {
                const active = draft.orderBy === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => patch({ orderBy: value })}
                    className={optionClass(active, "cyan")}
                  >
                    <span
                      className={`block text-sm font-semibold ${active ? "text-brand-cyan" : "text-ink"}`}
                    >
                      {orderLabel(value, sourceLabel)}
                    </span>
                    <span className="mt-0.5 block text-xs leading-tight text-ink-muted">
                      {orderHelp(value, sourceLabel)}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-ink-muted">
              You can change this mid draft without losing a single pick.
            </p>
          </fieldset>
        )}

        {stepId === "tracking" && (
          <fieldset>
            <legend className="sr-only">{STEP_QUESTION.tracking}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["mine", "all"] as TrackingMode[]).map((value) => {
                const active = draft.trackingMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => patch({ trackingMode: value })}
                    className={optionClass(active, "purple")}
                  >
                    <span
                      className={`block text-sm font-semibold ${active ? "text-brand-purple" : "text-ink"}`}
                    >
                      {TRACKING_TITLE[value]}
                    </span>
                    <span className="mt-0.5 block text-xs leading-tight text-ink-muted">
                      {TRACKING_BODY[value]}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-ink-muted">
              This decides what the second button on every player does: take him
              off the list, or ask which manager got him.
            </p>
          </fieldset>
        )}

        {stepId === "room" && (
          <div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={countId} className="block text-sm font-medium text-ink">
                  How many teams?
                </label>
                <input
                  id={countId}
                  type="number"
                  inputMode="numeric"
                  min={MIN_TEAMS}
                  max={MAX_TEAMS}
                  value={draft.teamCountText}
                  onChange={(event) => patch({ teamCountText: event.target.value })}
                  onBlur={commitTeamCount}
                  aria-describedby={`${countId}-help`}
                  className={`${inputClass} mt-2`}
                />
                <p id={`${countId}-help`} className="mt-1 text-xs text-ink-subtle">
                  Anywhere from {MIN_TEAMS} to {MAX_TEAMS}. This is what turns each
                  pick into a draft slot, so the fourth pick of a 12 team draft
                  reads 1.04 and the thirteenth reads 2.01.
                </p>
              </div>
              {draft.trackingMode === "all" && (
                <div>
                  <label htmlFor={mySlotId} className="block text-sm font-medium text-ink">
                    Which one are you?
                  </label>
                  <select
                    id={mySlotId}
                    value={draft.myTeamSlot}
                    onChange={(event) => patch({ myTeamSlot: Number(event.target.value) })}
                    className={`${inputClass} mt-2`}
                  >
                    {slots.map((slot) => (
                      <option key={slot} value={slot}>
                        {teamLabel(draft.teamNames, slot)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Which seat is yours and what everyone is called only matter when
                every roster is being followed. The size of the room matters
                either way: it is what makes a pick a draft slot. */}
            {draft.trackingMode === "all" && (
              <>
                <button
              type="button"
              onClick={() => setNamesOpen((open) => !open)}
              aria-expanded={namesOpen}
              aria-controls={namesId}
              className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 transition-transform ${namesOpen ? "rotate-180" : ""}`}
              />
              Name the teams (optional)
            </button>

            <div id={namesId} hidden={!namesOpen}>
              <p className="mt-2 text-xs text-ink-subtle">
                Leave any of these blank and it stays Team 1, Team 2, and so on.
                You can rename them later without losing a pick.
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {slots.map((slot) => (
                  <li key={slot}>
                    <label
                      htmlFor={`${namesId}-${slot}`}
                      className="block text-xs font-medium text-ink-muted"
                    >
                      Team {slot + 1}
                      {slot === draft.myTeamSlot ? " (you)" : ""}
                    </label>
                    <input
                      id={`${namesId}-${slot}`}
                      value={draft.teamNames[slot] ?? ""}
                      maxLength={MAX_TEAM_NAME_LENGTH}
                      onChange={(event) => setTeamName(slot, event.target.value)}
                      placeholder={`Team ${slot + 1}`}
                      autoComplete="off"
                      className={`${inputClass} mt-1`}
                    />
                  </li>
                ))}
              </ul>
                </div>
              </>
            )}
          </div>
        )}

        {stepId === "name" && (
          <div>
            <label htmlFor={nameId} className="sr-only">
              {STEP_QUESTION.name}
            </label>
            <input
              id={nameId}
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              maxLength={80}
              placeholder="Home league, 2026"
              autoComplete="off"
              aria-describedby={`${nameId}-help`}
              className={`${inputClass} sm:max-w-sm`}
            />
            <p id={`${nameId}-help`} className="mt-3 text-sm leading-relaxed text-ink-muted">
              This is how you will find the draft again later, so give it
              something you will recognise. Leave it blank and we call it{" "}
              {DEFAULT_DRAFT_NAME}.
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={goBack}
            aria-disabled={stepIndex === 0}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-50"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back
          </button>

          {isLastStep ? (
            <button
              type="button"
              onClick={submit}
              aria-disabled={submitting}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-50"
            >
              <Play aria-hidden="true" className="h-4 w-4" />
              {submitting ? "Starting..." : "Start drafting"}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Continue
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </Panel>
    </div>
  );
}
