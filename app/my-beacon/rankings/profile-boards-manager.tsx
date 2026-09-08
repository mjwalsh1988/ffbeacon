"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Eye, Star } from "lucide-react";
import {
  scopeLabel,
  PROFILE_TOP_N_CHOICES,
  PRIMARY_TOP_N_DEFAULT,
  SECONDARY_TOP_N_DEFAULT,
  type ProfileBoard,
} from "@/lib/ranking-boards";
import {
  featureBoard as featureBoardAction,
  unfeatureBoard as unfeatureBoardAction,
  makeBoardPrimary,
  moveBoardOrder,
  setBoardProfileTopN,
} from "./actions";

export type { ProfileBoard } from "@/lib/ranking-boards";

const TOP_N_CHOICES = PROFILE_TOP_N_CHOICES;

/**
 * Profile-display curation for a user's personal ranking boards. Lets the owner
 * decide which boards appear on their (future) public profile, pick exactly one
 * as the headline ("primary") board, and order the remaining "secondary" boards.
 *
 * Every write goes through a server action in `./actions.ts`, which re-derives
 * the caller from the request-scoped session client, re-verifies board
 * ownership, and recomputes the invariants (at most one primary per user,
 * primary implies visible) from the database rather than trusting whatever
 * this component last rendered. Each action returns the caller's full,
 * freshly-read board list, which becomes the new local state, so this
 * component never has to guess what the server actually did. Controls are
 * disabled while a write is in flight so the ordered multi-statement updates
 * never overlap.
 */
export function ProfileBoardsManager({
  initialBoards,
}: {
  initialBoards: ProfileBoard[];
}) {
  const [boards, setBoards] = useState<ProfileBoard[]>(initialBoards);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const headingId = useId();

  const primary = useMemo(
    () => boards.find((b) => b.profileVisible && b.profileIsPrimary) ?? null,
    [boards],
  );
  const secondaries = useMemo(
    () =>
      boards
        .filter((b) => b.profileVisible && !b.profileIsPrimary)
        .sort((a, b) => a.profileSort - b.profileSort),
    [boards],
  );
  const hidden = useMemo(
    () => boards.filter((b) => !b.profileVisible),
    [boards],
  );
  const featuredCount = (primary ? 1 : 0) + secondaries.length;

  // Run a server action, then commit the board list it returns (the action
  // recomputes every affected row from the database, so this never trusts a
  // guess of its own). On any failure we surface a message and leave state
  // untouched, so the UI still reflects what is actually persisted.
  const run = useCallback(
    async (
      action: () => Promise<
        { ok: true; boards: ProfileBoard[] } | { ok: false; error: string }
      >,
      message: string,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setBoards(result.boards);
        setAnnouncement(message);
      } catch {
        setError("Could not update your profile display. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Turn a board ON for the profile. The server decides whether it becomes
  // the primary (the first board featured always does) and where it lands in
  // the secondary order.
  const featureBoard = useCallback(
    (board: ProfileBoard) => {
      const hasPrimary = boards.some(
        (b) => b.profileVisible && b.profileIsPrimary,
      );
      void run(
        () => featureBoardAction(board.id),
        `${board.name} is now on your profile${hasPrimary ? "" : " as your primary board"}.`,
      );
    },
    [boards, run],
  );

  // Turn a board OFF. If it was the primary, the server promotes the first
  // secondary so the profile keeps a headline board whenever any board is
  // still featured.
  const unfeatureBoard = useCallback(
    (board: ProfileBoard) => {
      void run(
        () => unfeatureBoardAction(board.id),
        `${board.name} is no longer on your profile.`,
      );
    },
    [run],
  );

  // Make a featured secondary the primary. The server swaps the old primary
  // into the slot the chosen board vacated, so the secondary order stays
  // sensible.
  const makePrimary = useCallback(
    (board: ProfileBoard) => {
      const old = boards.find((b) => b.profileVisible && b.profileIsPrimary);
      if (old && old.id === board.id) return;
      void run(
        () => makeBoardPrimary(board.id),
        `${board.name} is now your primary board.`,
      );
    },
    [boards, run],
  );

  // Reorder a secondary up or down; the server swaps sort values with its
  // neighbour.
  const moveSecondary = useCallback(
    (board: ProfileBoard, direction: "up" | "down") => {
      void run(
        () => moveBoardOrder(board.id, direction),
        `Moved ${board.name} ${direction} in your profile order.`,
      );
    },
    [run],
  );

  // Set how many ranked players show in this board's profile summary. null
  // restores the per-role default (10 primary / 5 secondary).
  const setTopN = useCallback(
    (board: ProfileBoard, value: number | null) => {
      void run(
        () => setBoardProfileTopN(board.id, value),
        `Updated how many players show for ${board.name}.`,
      );
    },
    [run],
  );

  return (
    <section aria-labelledby={headingId}>
      <SectionEyebrow>Public profile</SectionEyebrow>
      <h2
        id={headingId}
        className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl"
      >
        Feature boards on your profile.
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Choose which boards appear on your public FF Beacon profile, pick one as
        the headline, and order the rest. Every board is private until you turn
        it on here.
      </p>

      {/* Polite status updates for screen readers. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div aria-live="assertive" className="min-h-[1.25rem]">
        {error && (
          <p role="alert" className="mt-3 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>

      <div className="mt-6 space-y-8">
        {/* Featured, in display order ------------------------------------ */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              On your profile
            </h3>
            <span className="text-xs text-ink-subtle">
              {featuredCount} of {boards.length} shown
            </span>
          </div>

          {featuredCount === 0 ? (
            <p className="mt-3 rounded-card border border-dashed border-line bg-base/40 p-5 text-sm text-ink-muted">
              No boards on your profile yet. Turn on a board below to feature it.
            </p>
          ) : (
            <ol role="list" className="mt-3 flex flex-col gap-2">
              {primary && (
                <FeaturedRow
                  key={primary.id}
                  board={primary}
                  isPrimary
                  busy={busy}
                  onUnfeature={unfeatureBoard}
                  onSetTopN={setTopN}
                />
              )}
              {secondaries.map((board, index) => (
                <FeaturedRow
                  key={board.id}
                  board={board}
                  position={index + 1}
                  isFirst={index === 0}
                  isLast={index === secondaries.length - 1}
                  busy={busy}
                  onUnfeature={unfeatureBoard}
                  onMakePrimary={makePrimary}
                  onMove={moveSecondary}
                  onSetTopN={setTopN}
                />
              ))}
            </ol>
          )}
        </div>

        {/* Not on the profile ------------------------------------------- */}
        {hidden.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              Not on your profile
            </h3>
            <ul role="list" className="mt-3 flex flex-col gap-2">
              {hidden.map((board) => (
                <HiddenRow
                  key={board.id}
                  board={board}
                  busy={busy}
                  onFeature={featureBoard}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- Featured row ---------------- */

function FeaturedRow({
  board,
  isPrimary = false,
  position,
  isFirst = false,
  isLast = false,
  busy,
  onUnfeature,
  onMakePrimary,
  onMove,
  onSetTopN,
}: {
  board: ProfileBoard;
  isPrimary?: boolean;
  position?: number;
  isFirst?: boolean;
  isLast?: boolean;
  busy: boolean;
  onUnfeature: (board: ProfileBoard) => void;
  onMakePrimary?: (board: ProfileBoard) => void;
  onMove?: (board: ProfileBoard, direction: "up" | "down") => void;
  onSetTopN: (board: ProfileBoard, value: number | null) => void;
}) {
  const topNSelectId = useId();
  const effectiveDefault = isPrimary
    ? PRIMARY_TOP_N_DEFAULT
    : SECONDARY_TOP_N_DEFAULT;
  return (
    <li
      className={`flex flex-col gap-3 rounded-card border bg-base p-3 sm:flex-row sm:items-center sm:gap-3 ${
        isPrimary ? "border-brand-purple/50" : "border-line"
      }`}
    >
      {/* Rank / primary marker + identity */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {isPrimary ? (
          <span
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-brand-purple/50 bg-brand-purple/15 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-purple"
          >
            <Star aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
            Primary
          </span>
        ) : (
          <span className="w-7 shrink-0 text-center font-mono text-sm tabular-nums text-ink-subtle">
            {position}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{board.name}</p>
          <p className="truncate text-xs text-ink-subtle">
            {scopeLabel(board.scope)} board, {board.playerCount} player
            {board.playerCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-end gap-1.5 sm:shrink-0">
        <span className="flex items-center gap-1.5">
          <label
            htmlFor={topNSelectId}
            className="text-xs font-medium text-ink-subtle"
          >
            Show
          </label>
          <select
            id={topNSelectId}
            value={board.profileTopN ?? ""}
            disabled={busy}
            onChange={(event) =>
              onSetTopN(
                board,
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
            aria-label={`How many players to show for ${board.name}`}
            className="h-11 rounded-card border border-line bg-surface px-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40 sm:h-9"
          >
            <option value="">Default ({effectiveDefault})</option>
            {TOP_N_CHOICES.map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
        </span>

        {!isPrimary && onMove && (
          <>
            <button
              type="button"
              onClick={() => onMove(board, "up")}
              disabled={busy || isFirst}
              aria-label={`Move ${board.name} up in your profile order`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30 sm:h-9 sm:w-9"
            >
              <ChevronUp aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onMove(board, "down")}
              disabled={busy || isLast}
              aria-label={`Move ${board.name} down in your profile order`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30 sm:h-9 sm:w-9"
            >
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </button>
          </>
        )}

        {!isPrimary && onMakePrimary && (
          <button
            type="button"
            onClick={() => onMakePrimary(board)}
            disabled={busy}
            aria-label={`Make ${board.name} your primary profile board`}
            className="inline-flex h-11 items-center gap-1.5 rounded-card border border-line px-3 text-xs font-semibold text-ink-muted hover:border-brand-purple/60 hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40 sm:h-9"
          >
            <Star aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Make primary</span>
            <span className="sm:hidden">Primary</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => onUnfeature(board)}
          disabled={busy}
          aria-label={`Remove ${board.name} from your profile`}
          className="inline-flex h-11 items-center rounded-card border border-line px-3 text-xs font-semibold text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40 sm:h-9"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/* ---------------- Hidden row ---------------- */

function HiddenRow({
  board,
  busy,
  onFeature,
}: {
  board: ProfileBoard;
  busy: boolean;
  onFeature: (board: ProfileBoard) => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-base/60 p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{board.name}</p>
        <p className="truncate text-xs text-ink-subtle">
          {scopeLabel(board.scope)} board, {board.playerCount} player
          {board.playerCount === 1 ? "" : "s"}
        </p>
      </div>
      <div className="flex items-center justify-end sm:shrink-0">
        <button
          type="button"
          onClick={() => onFeature(board)}
          disabled={busy}
          aria-label={`Show ${board.name} on your profile`}
          className="inline-flex h-11 items-center gap-1.5 rounded-card border border-line px-3 text-sm font-semibold text-brand-cyan hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40 sm:h-9"
        >
          <Eye aria-hidden="true" className="h-4 w-4" />
          Show on profile
        </button>
      </div>
    </li>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
