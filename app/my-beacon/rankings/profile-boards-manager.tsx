"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Eye, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { scopeLabel, type BoardScope } from "@/lib/ranking-boards";
import { revalidateMySignal } from "./actions";

// Top-N choices the owner can pick for a featured board. "Default" (null) means
// the profile uses 10 for the primary board and 5 for secondary boards.
const TOP_N_CHOICES = [5, 10, 15, 20, 25, 50] as const;
const PRIMARY_TOP_N_DEFAULT = 10;
const SECONDARY_TOP_N_DEFAULT = 5;

/**
 * Profile-display curation for a user's personal ranking boards. Lets the owner
 * decide which boards appear on their (future) public profile, pick exactly one
 * as the headline ("primary") board, and order the remaining "secondary" boards.
 *
 * All writes go through the browser Supabase client and are gated by the
 * owner-only RLS policies on user_ranking_boards (auth.uid() = user_id). The
 * database also enforces the two hard invariants (at most one primary per user,
 * primary implies visible), so this component keeps the invariants client-side
 * and lets the DB be the backstop. Controls are disabled while a write is in
 * flight so the ordered multi-statement updates never overlap.
 */

export type ProfileBoard = {
  id: string;
  name: string;
  scope: BoardScope;
  playerCount: number;
  profileVisible: boolean;
  profileIsPrimary: boolean;
  profileSort: number;
  /** How many ranked players show in the board's profile summary. Null = the
   * default (10 primary / 5 secondary). */
  profileTopN: number | null;
};

const TABLE = "user_ranking_boards";

export function ProfileBoardsManager({
  initialBoards,
}: {
  initialBoards: ProfileBoard[];
}) {
  const supabase = useMemo(() => createClient(), []);
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

  // Run an ordered set of writes, then commit the local state the writes
  // produced. On any failure we surface a message and leave state untouched, so
  // the UI still reflects what is actually persisted.
  const run = useCallback(
    async (work: () => Promise<void>, message: string) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        setAnnouncement(message);
        // Bust the cached public profile bundle so the change shows on /u/.
        void revalidateMySignal();
      } catch {
        setError("Could not update your profile display. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const stamp = () => new Date().toISOString();

  // Turn a board ON for the profile. The first board featured becomes the
  // primary automatically; later ones land at the end of the secondary order.
  const featureBoard = useCallback(
    (board: ProfileBoard) => {
      const hasPrimary = boards.some(
        (b) => b.profileVisible && b.profileIsPrimary,
      );
      const becomePrimary = !hasPrimary;
      const maxSort = secondaries.reduce(
        (max, b) => Math.max(max, b.profileSort),
        -1,
      );
      const nextSort = becomePrimary ? 0 : maxSort + 1;
      void run(async () => {
        const { error: updateError } = await supabase
          .from(TABLE)
          .update({
            profile_visible: true,
            profile_is_primary: becomePrimary,
            profile_sort: nextSort,
            updated_at: stamp(),
          })
          .eq("id", board.id);
        if (updateError) throw updateError;
        setBoards((prev) =>
          prev.map((b) =>
            b.id === board.id
              ? {
                  ...b,
                  profileVisible: true,
                  profileIsPrimary: becomePrimary,
                  profileSort: nextSort,
                }
              : b,
          ),
        );
      }, `${board.name} is now on your profile${becomePrimary ? " as your primary board" : ""}.`);
    },
    [boards, secondaries, run, supabase],
  );

  // Turn a board OFF. If it was the primary, promote the first secondary so the
  // profile keeps a headline board whenever any board is still featured.
  const unfeatureBoard = useCallback(
    (board: ProfileBoard) => {
      const promote =
        board.profileIsPrimary && secondaries.length > 0
          ? secondaries[0]
          : null;
      void run(async () => {
        const { error: offError } = await supabase
          .from(TABLE)
          .update({
            profile_visible: false,
            profile_is_primary: false,
            updated_at: stamp(),
          })
          .eq("id", board.id);
        if (offError) throw offError;
        if (promote) {
          const { error: promoteError } = await supabase
            .from(TABLE)
            .update({
              profile_is_primary: true,
              profile_sort: 0,
              updated_at: stamp(),
            })
            .eq("id", promote.id);
          if (promoteError) throw promoteError;
        }
        setBoards((prev) =>
          prev.map((b) => {
            if (b.id === board.id)
              return { ...b, profileVisible: false, profileIsPrimary: false };
            if (promote && b.id === promote.id)
              return { ...b, profileIsPrimary: true, profileSort: 0 };
            return b;
          }),
        );
      }, `${board.name} is no longer on your profile.`);
    },
    [secondaries, run, supabase],
  );

  // Make a featured secondary the primary. The old primary swaps into the slot
  // the chosen board vacated, so the secondary order stays sensible.
  const makePrimary = useCallback(
    (board: ProfileBoard) => {
      const old = boards.find((b) => b.profileVisible && b.profileIsPrimary);
      if (old && old.id === board.id) return;
      const vacatedSort = board.profileSort;
      void run(async () => {
        // Clear the old primary FIRST so the one-primary-per-user index is
        // never momentarily violated.
        if (old) {
          const { error: clearError } = await supabase
            .from(TABLE)
            .update({
              profile_is_primary: false,
              profile_sort: vacatedSort,
              updated_at: stamp(),
            })
            .eq("id", old.id);
          if (clearError) throw clearError;
        }
        const { error: setError2 } = await supabase
          .from(TABLE)
          .update({ profile_is_primary: true, updated_at: stamp() })
          .eq("id", board.id);
        if (setError2) throw setError2;
        setBoards((prev) =>
          prev.map((b) => {
            if (old && b.id === old.id)
              return { ...b, profileIsPrimary: false, profileSort: vacatedSort };
            if (b.id === board.id) return { ...b, profileIsPrimary: true };
            return b;
          }),
        );
      }, `${board.name} is now your primary board.`);
    },
    [boards, run, supabase],
  );

  // Reorder a secondary up or down by swapping sort values with its neighbour.
  const moveSecondary = useCallback(
    (board: ProfileBoard, direction: "up" | "down") => {
      const index = secondaries.findIndex((b) => b.id === board.id);
      const swapIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || swapIndex < 0 || swapIndex >= secondaries.length) return;
      const a = secondaries[index];
      const b = secondaries[swapIndex];
      void run(async () => {
        const { error: e1 } = await supabase
          .from(TABLE)
          .update({ profile_sort: b.profileSort, updated_at: stamp() })
          .eq("id", a.id);
        if (e1) throw e1;
        const { error: e2 } = await supabase
          .from(TABLE)
          .update({ profile_sort: a.profileSort, updated_at: stamp() })
          .eq("id", b.id);
        if (e2) throw e2;
        setBoards((prev) =>
          prev.map((x) => {
            if (x.id === a.id) return { ...x, profileSort: b.profileSort };
            if (x.id === b.id) return { ...x, profileSort: a.profileSort };
            return x;
          }),
        );
      }, `Moved ${board.name} ${direction} in your profile order.`);
    },
    [secondaries, run, supabase],
  );

  // Set how many ranked players show in this board's profile summary. null
  // restores the per-role default (10 primary / 5 secondary).
  const setTopN = useCallback(
    (board: ProfileBoard, value: number | null) => {
      void run(async () => {
        const { error: topNError } = await supabase
          .from(TABLE)
          .update({ profile_top_n: value, updated_at: stamp() })
          .eq("id", board.id);
        if (topNError) throw topNError;
        setBoards((prev) =>
          prev.map((b) =>
            b.id === board.id ? { ...b, profileTopN: value } : b,
          ),
        );
      }, `Updated how many players show for ${board.name}.`);
    },
    [run, supabase],
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
