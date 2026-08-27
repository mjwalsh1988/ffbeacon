"use client";

/**
 * The draft room: the board, the rosters, and every button that changes them.
 *
 * WHO OWNS THE TRUTH WHILE A DRAFT IS RUNNING. The server does, but the screen
 * cannot wait for it. Every button updates local state first and calls its
 * action second; a failed action rolls that one change back and says why. A
 * draft moves faster than a round trip and a manager with eight seconds on the
 * clock should not be watching a spinner.
 *
 * EVERY ROLLBACK IS SCOPED TO ONE PLAYER. It would be easier to snapshot the
 * whole pick list before a write and restore it on failure, and it would be
 * wrong: only the row being written is disabled, so a reader can take player B
 * while A is still in flight, and restoring A's snapshot would erase B's
 * already-committed pick and put a drafted player back on the board. Same reason
 * `busyPlayerIds` is a set rather than one id.
 *
 * PICK ORDER DOES NOT COME FROM THE CLIENT CLOCK. An optimistic pick is stamped
 * one millisecond after the latest pick already held, not at `Date.now()`, so a
 * skewed device cannot interleave new picks among old ones. Re-taking a player
 * already off the board keeps his original stamp, which is exactly what the
 * server's upsert does, so his pick number does not jump to the end on screen
 * and stay put in the database.
 *
 * WHY THE BOARD IS NOT RELOADED PER PICK. `players` is the full ranked list for
 * the format and never changes during a draft. What changes is which of them are
 * gone, which is one Set lookup per row. So a pick costs a filter over roughly
 * 800 objects, not a fetch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eraser, RotateCcw, Undo2 } from "lucide-react";
import { Panel, StatReadout } from "@/components/dashboard-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageRail } from "@/components/app-shell/page-rail";
import {
  describeDraftSlot,
  draftSlotLabel,
  orderLabel,
  teamLabel,
} from "@/lib/draft-tracker/order";
import {
  type DraftOrder,
  type DraftTracker,
  type DraftTrackerBoard,
  type TrackerPick,
  type TrackerPlayer,
} from "@/lib/draft-tracker/types";
import {
  clearPicks,
  reassignPick,
  recordPick,
  renameTracker,
  setTrackerOrder,
  setTrackerStatus,
  undoPick,
  type ActionResult,
} from "../actions";
import { AvailablePlayers } from "./available-players";
import { AssignTeamDialog } from "./assign-team-dialog";
import { DraftSettingsCard } from "./draft-settings-card";
import { RosterSheet } from "./roster-sheet";
import { TeamNamesDialog } from "./team-names-dialog";
import { TeamRosters, type RosterEntry, type RosterGroup } from "./team-rosters";

/** What the assign dialog is currently placing. */
type Assigning = {
  playerId: string;
  name: string;
  player: TrackerPlayer | null;
  currentSlot: number | null;
  /** True when the player is already off the board and this is a correction. */
  isMove: boolean;
};

export function DraftRoom({
  tracker,
  board,
  initialPicks,
  sourceFallback,
}: {
  tracker: DraftTracker;
  board: DraftTrackerBoard;
  initialPicks: TrackerPick[];
  /** Set when the reader's source does not cover this draft's format. */
  sourceFallback: { from: string; to: string } | null;
}) {
  const [picks, setPicks] = useState<TrackerPick[]>(initialPicks);
  const [orderBy, setOrderBy] = useState<DraftOrder>(tracker.orderBy);
  const [teamNames, setTeamNames] = useState<string[]>(tracker.teamNames);
  const [status, setStatus] = useState(tracker.status);
  const [busyPlayerIds, setBusyPlayerIds] = useState<Set<string>>(() => new Set());
  const [assigning, setAssigning] = useState<Assigning | null>(null);
  const [namesOpen, setNamesOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // Re-seed from the server when its copy actually changes. Comparing the
  // serialised pick list rather than the array identity keeps a re-render that
  // produced an equal array from resetting local state mid draft.
  const serverKey = useMemo(
    () => initialPicks.map((p) => `${p.playerId}:${p.teamSlot ?? "x"}`).join("|"),
    [initialPicks],
  );
  const lastServerKey = useRef(serverKey);
  useEffect(() => {
    if (serverKey === lastServerKey.current) return;
    lastServerKey.current = serverKey;
    setPicks(initialPicks);
  }, [serverKey, initialPicks]);

  const playersById = useMemo(() => {
    const map = new Map<string, TrackerPlayer>();
    for (const player of board.players) map.set(player.playerId, player);
    return map;
  }, [board.players]);

  const pickByPlayer = useMemo(() => {
    const map = new Map<string, TrackerPick>();
    for (const pick of picks) map.set(pick.playerId, pick);
    return map;
  }, [picks]);

  const available = useMemo(
    () => board.players.filter((p) => !pickByPlayer.has(p.playerId)),
    [board.players, pickByPlayer],
  );

  const orderedPicks = useMemo(
    () => picks.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
    [picks],
  );

  const myPickCount = orderedPicks.filter((p) => p.teamSlot === tracker.myTeamSlot).length;
  const lastPick = orderedPicks[orderedPicks.length - 1] ?? null;
  const lastPickName = lastPick
    ? (playersById.get(lastPick.playerId)?.name ?? "the last pick")
    : null;

  /**
   * The reader's own roster, and everybody else's, kept apart.
   *
   * They are drawn in different places now: yours in the page rail beside the
   * board from xl up, the rest under it, and both behind one tabbed sheet below
   * xl. So they are split here rather than at three call sites.
   */
  const { myGroup, otherGroups } = useMemo((): {
    myGroup: RosterGroup;
    otherGroups: RosterGroup[];
  } => {
    const groups = buildGroups();
    const mine = groups.find((group) => group.isMine);
    return {
      // The reader's own group is always built, in both tracking modes. The
      // fallback is here so the type is honest, not because it is reachable.
      myGroup: mine ?? {
        key: "mine",
        label: "Your team",
        isMine: true,
        isUnassigned: false,
        slot: tracker.myTeamSlot,
        entries: [],
      },
      otherGroups: groups.filter((group) => !group.isMine),
    };

    function buildGroups(): RosterGroup[] {
    // A pick whose player is not on the current board still belongs to somebody
    // and still has to be undoable, so it keeps its row with a null player.
    const all: { pick: TrackerPick; entry: RosterEntry }[] = orderedPicks.map(
      (pick, index) => ({
        pick,
        entry: {
          playerId: pick.playerId,
          player: playersById.get(pick.playerId) ?? null,
          pickNumber: index + 1,
          // The draft slot is derived from the pick's place in the recorded
          // order and the size of the room, so undoing a pick in the middle
          // renumbers every pick after it. Which is what happened.
          draftSlot: draftSlotLabel(index + 1, tracker.teamCount),
          draftSlotSpoken: describeDraftSlot(index + 1, tracker.teamCount),
        },
      }),
    );

    if (tracker.trackingMode === "mine") {
      const out: RosterGroup[] = [
        {
          key: "mine",
          label: "Your team",
          isMine: true,
          isUnassigned: false,
          slot: tracker.myTeamSlot,
          entries: all
            .filter((row) => row.pick.teamSlot === tracker.myTeamSlot)
            .map((row) => row.entry),
        },
      ];
      const others = all
        .filter((row) => row.pick.teamSlot !== tracker.myTeamSlot)
        .map((row) => row.entry);
      if (others.length > 0) {
        out.push({
          key: "gone",
          label: "Taken by someone else",
          isMine: false,
          isUnassigned: true,
          slot: null,
          entries: others,
        });
      }
      return out;
    }

    const out: RosterGroup[] = Array.from({ length: tracker.teamCount }, (_, slot) => ({
      key: `team-${slot}`,
      label: teamLabel(teamNames, slot),
      isMine: slot === tracker.myTeamSlot,
      isUnassigned: false,
      slot,
      entries: all.filter((row) => row.pick.teamSlot === slot).map((row) => row.entry),
    }));
    const unknown = all.filter((row) => row.pick.teamSlot === null).map((row) => row.entry);
    if (unknown.length > 0) {
      out.push({
        key: "unknown",
        label: "Owner not recorded",
        isMine: false,
        isUnassigned: true,
        slot: null,
        entries: unknown,
      });
    }
    return out;
    }
  }, [orderedPicks, playersById, teamNames, tracker.myTeamSlot, tracker.teamCount, tracker.trackingMode]);

  /** Stable single-element array, so the memo on TeamRosters can hold. */
  const myGroupOnly = useMemo(() => [myGroup], [myGroup]);

  const setBusy = useCallback((playerId: string, busy: boolean) => {
    setBusyPlayerIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(playerId);
      else next.delete(playerId);
      return next;
    });
  }, []);

  /**
   * One shape for every write: change the screen, run the action, and put only
   * what this write changed back if the action said no.
   *
   * A failure sets the error and NOT the announcement. The error renders in a
   * role="alert", which is already assertive, and writing the same sentence into
   * the polite region as well makes a screen reader say it twice.
   */
  const mutate = useCallback(
    async (options: {
      playerId?: string;
      apply: () => void;
      revert: () => void;
      run: () => Promise<ActionResult>;
      say: string;
    }) => {
      options.apply();
      setAnnouncement(options.say);
      setError(null);
      if (options.playerId) setBusy(options.playerId, true);
      const result = await options.run();
      if (options.playerId) setBusy(options.playerId, false);
      if (!result.ok) {
        options.revert();
        setAnnouncement("");
        setError(result.error);
      }
      return result;
    },
    [setBusy],
  );

  /** How many are left once `delta` more players come off the board. */
  const remainingAfter = useCallback(
    (delta: number) => {
      const left = board.players.length - (picks.length + delta);
      return `${left} ${left === 1 ? "player" : "players"} left.`;
    },
    [board.players.length, picks.length],
  );

  /**
   * Put a player off the board, or move one who already is.
   *
   * The stamp is derived from the picks already held rather than read off the
   * clock, and a player who already has a pick keeps his, which is what the
   * server's upsert does on conflict.
   */
  const addPick = useCallback(
    (player: TrackerPlayer, slot: number | null, say: string) => {
      const existing = pickByPlayer.get(player.playerId) ?? null;
      return mutate({
        playerId: player.playerId,
        apply: () =>
          setPicks((prev) => {
            const rest = prev.filter((p) => p.playerId !== player.playerId);
            const latest = rest.reduce(
              (max, p) => (p.createdAt > max ? p.createdAt : max),
              "",
            );
            const createdAt =
              existing?.createdAt ??
              new Date(
                Math.max(Date.now(), latest ? Date.parse(latest) + 1 : 0),
              ).toISOString();
            return [...rest, { playerId: player.playerId, teamSlot: slot, createdAt }];
          }),
        revert: () =>
          setPicks((prev) => {
            const rest = prev.filter((p) => p.playerId !== player.playerId);
            return existing ? [...rest, existing] : rest;
          }),
        run: () => recordPick(tracker.id, player.playerId, slot),
        say,
      });
    },
    [mutate, pickByPlayer, tracker.id],
  );

  const handleDraftToMe = useCallback(
    (player: TrackerPlayer) => {
      void addPick(
        player,
        tracker.myTeamSlot,
        `${player.name} is on your team. ${remainingAfter(1)}`,
      );
    },
    [addPick, remainingAfter, tracker.myTeamSlot],
  );

  const handleMarkTaken = useCallback(
    (player: TrackerPlayer) => {
      if (tracker.trackingMode === "all") {
        setAssigning({
          playerId: player.playerId,
          name: player.name,
          player,
          currentSlot: null,
          isMove: false,
        });
        return;
      }
      void addPick(player, null, `${player.name} is off the board. ${remainingAfter(1)}`);
    },
    [addPick, remainingAfter, tracker.trackingMode],
  );

  const handleAssign = useCallback(
    (slot: number | null) => {
      const target = assigning;
      setAssigning(null);
      if (!target) return;
      const where =
        slot === null
          ? "off the board, owner not recorded"
          : `on ${teamLabel(teamNames, slot)}`;

      if (target.isMove) {
        const previous = pickByPlayer.get(target.playerId) ?? null;
        void mutate({
          playerId: target.playerId,
          apply: () =>
            setPicks((prev) =>
              prev.map((p) =>
                p.playerId === target.playerId ? { ...p, teamSlot: slot } : p,
              ),
            ),
          revert: () =>
            setPicks((prev) =>
              prev.map((p) =>
                p.playerId === target.playerId && previous ? previous : p,
              ),
            ),
          run: () => reassignPick(tracker.id, target.playerId, slot),
          // Not "he": a team defense is on this path too.
          say: `${target.name} moved. That pick is now ${where}.`,
        });
        return;
      }
      if (!target.player) return;
      void addPick(target.player, slot, `${target.name} is ${where}. ${remainingAfter(1)}`);
    },
    [addPick, assigning, mutate, pickByPlayer, remainingAfter, teamNames, tracker.id],
  );

  const handleUndo = useCallback(
    (playerId: string, name: string) => {
      const existing = pickByPlayer.get(playerId) ?? null;
      void mutate({
        playerId,
        apply: () => setPicks((prev) => prev.filter((p) => p.playerId !== playerId)),
        revert: () =>
          setPicks((prev) =>
            existing && !prev.some((p) => p.playerId === playerId)
              ? [...prev, existing]
              : prev,
          ),
        run: () => undoPick(tracker.id, playerId),
        say: `${name} is back on the board. ${remainingAfter(-1)}`,
      });
    },
    [mutate, pickByPlayer, remainingAfter, tracker.id],
  );

  const handleReassign = useCallback((entry: RosterEntry, currentSlot: number | null) => {
    setAssigning({
      playerId: entry.playerId,
      name: entry.player?.name ?? "This pick",
      player: entry.player,
      currentSlot,
      isMove: true,
    });
  }, []);

  const handleChangeOrder = useCallback(
    (next: DraftOrder) => {
      if (next === orderBy) return;
      const previous = orderBy;
      void mutate({
        apply: () => setOrderBy(next),
        revert: () => setOrderBy(previous),
        run: () => setTrackerOrder(tracker.id, next),
        say: `Board ordered by ${orderLabel(next, board.sourceLabel)}.`,
      });
    },
    [board.sourceLabel, mutate, orderBy, tracker.id],
  );

  const handleSaveNames = useCallback(
    async (names: string[]) => {
      const previous = teamNames;
      const result = await mutate({
        apply: () => setTeamNames(names),
        revert: () => setTeamNames(previous),
        run: () => renameTracker({ trackerId: tracker.id, teamNames: names }),
        // The dialog says so itself: a status region on the page behind an
        // aria-modal container is one the reader cannot hear.
        say: "",
      });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    [mutate, teamNames, tracker.id],
  );

  const handleToggleStatus = useCallback(() => {
    const next = status === "active" ? "complete" : "active";
    const previous = status;
    void mutate({
      apply: () => setStatus(next),
      revert: () => setStatus(previous),
      run: () => setTrackerStatus(tracker.id, next),
      say: next === "complete" ? "Draft marked finished." : "Draft reopened.",
    });
  }, [mutate, status, tracker.id]);

  const handleClear = useCallback(() => {
    setConfirmClear(false);
    const snapshot = picks;
    void mutate({
      apply: () => setPicks([]),
      // The only place a whole-list restore is right: clearing IS the whole list.
      revert: () => setPicks(snapshot),
      run: () => clearPicks(tracker.id),
      say: `Board cleared. All ${board.players.length} players are back.`,
    });
  }, [board.players.length, mutate, picks, tracker.id]);

  const modeLine =
    tracker.trackingMode === "all"
      ? `Tracking all ${tracker.teamCount} teams. You are ${teamLabel(teamNames, tracker.myTeamSlot)}.`
      : "Tracking your team only.";

  if (board.status !== "ok") {
    return (
      <Panel
        eyebrow="Draft Tracker"
        title={tracker.name}
        helper={`${tracker.formatLabel}. ${modeLine}`}
        headingLevel={2}
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          {board.sourceLabel} has no ranked players for {tracker.formatLabel} at
          the moment, so there is nothing to draft from yet. Switching your data
          source in the site header may fill it in.
        </p>
      </Panel>
    );
  }

  const secondaryButton =
    "inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan aria-disabled:opacity-50";

  return (
    <div className="space-y-6">
      <Panel
        eyebrow="Draft Tracker"
        title={tracker.name}
        // The setup facts live in the settings card below, so this says the one
        // thing that card cannot: every tap is already saved.
        helper="Saved as you go. Close the page and pick it back up from your saved drafts."
        headingLevel={2}
        glow
      >
        {sourceFallback && (
          <p className="mb-4 rounded-card border border-brand-purple/40 bg-brand-purple/10 px-3 py-2 text-xs leading-relaxed text-ink">
            {sourceFallback.from} does not publish {tracker.formatLabel}, so this
            board is using {sourceFallback.to}. Your saved source has not been
            changed.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatReadout label="Still available" value={String(available.length)} />
          <StatReadout label="Off the board" value={String(orderedPicks.length)} accent="ink" />
          <StatReadout label="On your team" value={String(myPickCount)} accent="purple" />
          <StatReadout
            label="Draft"
            value={status === "complete" ? "Finished" : "Running"}
            accent="ink"
          />
        </dl>

        {/* The wizard's answers, settled. Ordering is the one that stays live,
            and it lives here with the other three rather than above the table. */}
        <div className="mt-4">
          <DraftSettingsCard
            formatLabel={tracker.formatLabel}
            sourceLabel={board.sourceLabel}
            orderBy={orderBy}
            trackingMode={tracker.trackingMode}
            teamCount={tracker.teamCount}
            myTeamLabel={teamLabel(teamNames, tracker.myTeamSlot)}
            onChangeOrder={handleChangeOrder}
            onNameTeams={
              tracker.trackingMode === "all" ? () => setNamesOpen(true) : undefined
            }
          />
        </div>

        {/* These buttons stay mounted whether or not they have anything to do.
            A button that disappears when the last pick is undone takes the
            reader's focus with it. */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <button
            type="button"
            aria-disabled={!lastPick}
            onClick={() => {
              if (!lastPick || !lastPickName) return;
              handleUndo(lastPick.playerId, lastPickName);
            }}
            className={secondaryButton}
          >
            <Undo2 aria-hidden="true" className="h-4 w-4" />
            {lastPickName ? `Undo ${lastPickName}` : "Undo the last pick"}
          </button>
          <button type="button" onClick={handleToggleStatus} className={secondaryButton}>
            {status === "complete" ? (
              <>
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Reopen draft
              </>
            ) : (
              <>
                <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                Mark finished
              </>
            )}
          </button>
          <button
            type="button"
            aria-disabled={orderedPicks.length === 0}
            onClick={() => {
              if (orderedPicks.length === 0) return;
              setConfirmClear(true);
            }}
            className={`${secondaryButton} hover:border-signal-danger/60 hover:text-signal-danger`}
          >
            <Eraser aria-hidden="true" className="h-4 w-4" />
            Start the board over
          </button>
        </div>

        {/* One polite region for what the buttons here do, and one alert for a
            refusal. The board has its own region for searching and filtering;
            the sort headers deliberately do not use it, because the ordering
            change is announced from here. */}
        <p role="status" className="sr-only">
          {announcement}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-signal-danger">
            {error}
          </p>
        )}
      </Panel>

      <div>
        {/* Below xl this is the only home the rosters have, so its bar leads the
            board rather than following it. Above xl it renders nothing: the rail
            and the panel underneath take over. */}
        <RosterSheet
          myGroup={myGroup}
          otherGroups={otherGroups}
          sourceLabel={board.sourceLabel}
          canReassign={tracker.trackingMode === "all"}
          onUndo={handleUndo}
          onReassign={handleReassign}
          busyPlayerIds={busyPlayerIds}
        />

        <Panel
          eyebrow="The board"
          title="Who is left"
          helper="Mine takes a player for your team. Gone takes him off the list."
          headingLevel={2}
        >
          <AvailablePlayers
            players={available}
            orderBy={orderBy}
            sourceLabel={board.sourceLabel}
            hasAdp={board.adpKey !== null}
            trackingMode={tracker.trackingMode}
            onDraftToMe={handleDraftToMe}
            onMarkTaken={handleMarkTaken}
            onChangeOrder={handleChangeOrder}
            busyPlayerIds={busyPlayerIds}
          />
        </Panel>
      </div>

      {/* Your own team goes in the page rail, beside the board. The portal is
          why this can live here in the tree and render over there. Hidden below
          xl by the rail itself, where the sheet above is carrying it instead. */}
      <PageRail>
        <Panel
          eyebrow="Your team"
          title="What you have taken"
          helper="The undo button puts anyone back on the board."
          headingLevel={2}
        >
          <TeamRosters
            groups={myGroupOnly}
            sourceLabel={board.sourceLabel}
            canReassign={tracker.trackingMode === "all"}
            onUndo={handleUndo}
            onReassign={handleReassign}
            busyPlayerIds={busyPlayerIds}
            singleColumn
          />
        </Panel>
      </PageRail>

      {otherGroups.length > 0 && (
        <Panel
          className="hidden xl:block"
          eyebrow={tracker.trackingMode === "all" ? "Every other roster" : "Off the board"}
          title={
            tracker.trackingMode === "all"
              ? "How the room is shaping up"
              : "Taken by someone else"
          }
          helper={
            tracker.trackingMode === "all"
              ? `Totals are ${board.sourceLabel} value, for comparing rosters in this draft.`
              : "Put anyone back on the board with the undo button."
          }
          headingLevel={2}
        >
          <TeamRosters
            groups={otherGroups}
            sourceLabel={board.sourceLabel}
            canReassign={tracker.trackingMode === "all"}
            onUndo={handleUndo}
            onReassign={handleReassign}
            busyPlayerIds={busyPlayerIds}
          />
        </Panel>
      )}

      <AssignTeamDialog
        player={assigning?.player ?? null}
        playerName={assigning?.name ?? null}
        teamCount={tracker.teamCount}
        teamNames={teamNames}
        myTeamSlot={tracker.myTeamSlot}
        isMove={assigning?.isMove ?? false}
        currentSlot={assigning?.currentSlot ?? null}
        onAssign={handleAssign}
        onClose={() => setAssigning(null)}
      />

      <TeamNamesDialog
        open={namesOpen}
        teamCount={tracker.teamCount}
        teamNames={teamNames}
        myTeamSlot={tracker.myTeamSlot}
        onSave={handleSaveNames}
        onClose={() => setNamesOpen(false)}
      />

      {confirmClear && (
        <ConfirmDialog
          title="Put every player back?"
          description={`All ${orderedPicks.length} recorded picks are cleared and the board goes back to full. The draft itself is kept.`}
          confirmLabel="Clear the board"
          tone="danger"
          icon={Eraser}
          onConfirm={handleClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
