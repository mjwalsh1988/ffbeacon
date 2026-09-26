"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Layers, SeparatorHorizontal, X } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { TierBreakLine } from "@/components/ranking-boards/tier-break-line";
import { RankGapChip } from "@/components/ranking-boards/rank-gap-chip";
import { saveBoardPlayers, saveBoardMeta, replaceBoardFromImport } from "../actions";
import {
  addTierBreak,
  BOARD_POSITIONS,
  computeBoardRanks,
  isSinglePositionScope,
  MAX_BOARD_NAME_LENGTH,
  moveTierBreak,
  normalizeTierBreaks,
  removeTierBreak,
  scopeLabel,
  scopePositions,
  shiftLabelsForAddedBreak,
  shiftLabelsForRemovedBreak,
  tierForRank,
  tierRanges,
  type BoardPlayer,
  type BoardScope,
  type ImportedRankingPlayer,
  type SearchablePlayer,
} from "@/lib/ranking-boards";
import { readerRanksFor, rankGap, type RankComparison } from "@/lib/ranking-boards/compare";
import { isDefender, positionNoun } from "@/lib/site";
import { AddPlayerCombobox } from "./add-player-combobox";
import { ImportFromRankings, type ImportFormat, type ImportSource } from "./import-from-rankings";
import { PositionFilterBar, type PositionFilter } from "./position-filter-bar";
import { AddTierBreakForm, TierBreakLineControls } from "./tier-break-controls";
import { CommunityPanel } from "./community-panel";

const SAVE_DEBOUNCE_MS = 700;

type DragItem = { kind: "player"; id: string } | { kind: "break"; rank: number };

export type { ImportFormat, ImportSource };

export function BoardEditor({
  boardId,
  initialName,
  scope,
  includesDefenders,
  initialTiersEnabled,
  initialTierBreaks,
  initialTierLabels,
  initialPlayers,
  importSources,
  importFormats,
  defaultSourceSlug,
  boardFormatSlug,
  comparisons,
  community,
}: {
  boardId: string;
  initialName: string;
  scope: BoardScope;
  includesDefenders: boolean;
  initialTiersEnabled: boolean;
  initialTierBreaks: number[];
  initialTierLabels: Record<string, string>;
  initialPlayers: BoardPlayer[];
  importSources: ImportSource[];
  importFormats: ImportFormat[];
  defaultSourceSlug: string | null;
  /** The format the board was built for, when it has one. */
  boardFormatSlug: string | null;
  /** "vs FF Beacon" and, once published, "vs community". Two columns, never
   * one column for both. */
  comparisons: RankComparison[];
  /** The quiet community side panel (plan 9.1). */
  community: {
    optOut: boolean;
    minPlayers: number;
    hasFormat: boolean;
    formats: { slug: string; displayName: string }[];
  };
}) {
  // Ties the position chips to the list they filter, for aria-controls.
  const listId = useId();

  const [name, setName] = useState(initialName);
  const [tiersEnabled, setTiersEnabled] = useState(initialTiersEnabled);
  const [tierBreaks, setTierBreaks] = useState<number[]>(
    () => normalizeTierBreaks(initialTierBreaks, initialPlayers.length).breaks,
  );
  const [tierLabels, setTierLabels] = useState<Record<string, string>>(initialTierLabels);
  const [players, setPlayers] = useState<BoardPlayer[]>(initialPlayers);
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("all");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Polite, human announcement of the most recent structural change, for
  // screen readers (the visual list updates instantly for sighted users).
  const [announcement, setAnnouncement] = useState("");

  const boardPositions = scopePositions(scope, includesDefenders);
  const holdsDefenders = boardPositions.some((p) => isDefender(p));

  // ----- persistence plumbing -------------------------------------------
  const pendingRemovals = useRef<Set<string>>(new Set());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always read the freshest state inside the debounced flush.
  const playersRef = useRef(players);
  playersRef.current = players;
  const breaksRef = useRef(tierBreaks);
  breaksRef.current = tierBreaks;

  const flushPlayers = useCallback(async () => {
    const snapshot = playersRef.current;
    const removals = Array.from(pendingRemovals.current);
    pendingRemovals.current = new Set();
    setSaveState("saving");
    // The action re-derives ownership, validates every id and normalises the
    // breaks against the saved length.
    const result = await saveBoardPlayers(
      boardId,
      removals,
      snapshot.map((p) => p.playerId),
      breaksRef.current,
    );
    if (result.ok) {
      setSaveState("saved");
    } else {
      // Re-queue the removals we pulled so they aren't lost on a transient error.
      removals.forEach((id) => pendingRemovals.current.add(id));
      setSaveState("error");
    }
  }, [boardId]);

  const schedulePlayerSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void flushPlayers();
    }, SAVE_DEBOUNCE_MS);
  }, [flushPlayers]);

  // Flush any pending save when the component unmounts (navigation away).
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void flushPlayers();
      }
    };
  }, [flushPlayers]);

  // ----- board meta persistence -----------------------------------------
  type MetaPatch = {
    name?: string;
    tiersEnabled?: boolean;
    tierLabels?: Record<string, string>;
  };
  const pendingMeta = useRef<MetaPatch>({});
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeMeta = useCallback(
    async (patch: MetaPatch): Promise<boolean> => {
      setSaveState("saving");
      const result = await saveBoardMeta(boardId, patch);
      setSaveState(result.ok ? "saved" : "error");
      return result.ok;
    },
    [boardId],
  );

  const saveMeta = useCallback(
    (patch: MetaPatch) => {
      pendingMeta.current = { ...pendingMeta.current, ...patch };
      if (metaTimer.current) clearTimeout(metaTimer.current);
      metaTimer.current = setTimeout(() => {
        metaTimer.current = null;
        const toWrite = pendingMeta.current;
        pendingMeta.current = {};
        if (Object.keys(toWrite).length > 0) void writeMeta(toWrite);
      }, SAVE_DEBOUNCE_MS);
    },
    [writeMeta],
  );

  /** Cancel and hand back any queued meta patch, so an import can write it
   * first rather than let it land afterwards and clobber newer values. */
  const takePendingMeta = useCallback((): MetaPatch => {
    if (metaTimer.current) {
      clearTimeout(metaTimer.current);
      metaTimer.current = null;
    }
    const queued = pendingMeta.current;
    pendingMeta.current = {};
    return queued;
  }, []);

  /** Apply a new player list, keeping the lines at their ranks and dropping
   * (and announcing) any line the shorter board no longer reaches. */
  const commitPlayers = useCallback(
    (next: BoardPlayer[], message: string) => {
      const { breaks, removed } = normalizeTierBreaks(breaksRef.current, next.length);
      let labels = tierLabels;
      for (const rank of removed) {
        labels = shiftLabelsForRemovedBreak(labels, breaksRef.current, rank);
      }
      setPlayers(next);
      if (removed.length > 0) {
        setTierBreaks(breaks);
        setTierLabels(labels);
        saveMeta({ tierLabels: labels });
      }
      const lineNote =
        removed.length > 0 && tiersEnabled
          ? ` The tier line after rank ${removed.join(" and ")} was removed because the board is now shorter.`
          : "";
      setAnnouncement(`${message}${lineNote}`);
      schedulePlayerSave();
    },
    [tierLabels, tiersEnabled, saveMeta, schedulePlayerSave],
  );

  const importRankings = useCallback(
    async (
      imported: ImportedRankingPlayer[],
      provenance: { formatSlug: string; sourceSlug: string | null },
    ): Promise<boolean> => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      pendingRemovals.current = new Set();

      const queuedMeta = takePendingMeta();
      if (Object.keys(queuedMeta).length > 0) {
        const ok = await writeMeta(queuedMeta);
        if (!ok) {
          setSaveState("error");
          return false;
        }
      }

      setSaveState("saving");
      const result = await replaceBoardFromImport(
        boardId,
        imported.map((p) => ({ playerId: p.playerId, tier: p.tier })),
        provenance,
      );
      if (!result.ok) {
        setSaveState("error");
        return false;
      }

      // The table never stores name/position/etc, so rebuild the display list
      // from the import payload, in the SERVER's persisted order.
      const byId = new Map(imported.map((p) => [p.playerId, p]));
      const next: BoardPlayer[] = result.order.flatMap((playerId) => {
        const src = byId.get(playerId);
        if (!src) return [];
        return [
          {
            rowId: null,
            playerId,
            slug: src.slug,
            name: src.name,
            position: src.position,
            team: src.team,
            sleeperId: src.sleeperId,
          },
        ];
      });
      setPlayers(next);
      setTierBreaks(result.tierBreaks);
      setTierLabels({});
      setSaveState("saved");
      const tierNote =
        result.importedTiers && tiersEnabled
          ? ` with ${result.tierBreaks.length + 1} tiers from the source`
          : "";
      setAnnouncement(
        `Imported ${next.length} player${next.length === 1 ? "" : "s"} from rankings${tierNote}.`,
      );
      return true;
    },
    [boardId, takePendingMeta, writeMeta, tiersEnabled],
  );

  // ----- mutations -------------------------------------------------------
  const addPlayer = useCallback(
    (p: SearchablePlayer) => {
      if (players.some((x) => x.playerId === p.playerId)) return;
      pendingRemovals.current.delete(p.playerId);
      const next: BoardPlayer[] = [
        ...players,
        {
          rowId: null,
          playerId: p.playerId,
          slug: p.slug,
          name: p.name,
          position: p.position,
          team: p.team,
          sleeperId: p.sleeperId,
        },
      ];
      // A player added while a different position is on view lands on the
      // board but not in the visible list, so say so rather than report a
      // success the reader cannot find.
      commitPlayers(
        next,
        positionFilter !== "all" && p.position !== positionFilter
          ? `Added ${p.name} to the board at rank ${next.length}. They are not shown in the current ${positionNoun(positionFilter, "plural")} view.`
          : `Added ${p.name} to the board at rank ${next.length}.`,
      );
    },
    [players, positionFilter, commitPlayers],
  );

  const removePlayer = useCallback(
    (playerId: string) => {
      const target = players.find((x) => x.playerId === playerId);
      if (!target) return;
      pendingRemovals.current.add(playerId);
      commitPlayers(
        players.filter((x) => x.playerId !== playerId),
        `Removed ${target.name} from the board.`,
      );
    },
    [players, commitPlayers],
  );

  const movePlayer = useCallback(
    (playerId: string, direction: "up" | "down") => {
      const index = players.findIndex((x) => x.playerId === playerId);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || swapWith < 0 || swapWith >= players.length) return;
      const next = [...players];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      const passed = players[swapWith];
      const newRank = swapWith + 1;
      const tierNote =
        tiersEnabled && tierForRank(tierBreaks, newRank) !== tierForRank(tierBreaks, index + 1)
          ? `, now in tier ${tierForRank(tierBreaks, newRank)}`
          : "";
      // The row moves under the reader's focus: say where he landed and who
      // he passed, since nothing else would.
      commitPlayers(
        next,
        `${players[index].name} moved ${direction} to rank ${newRank}, ${
          direction === "up" ? "above" : "below"
        } ${passed.name}${tierNote}.`,
      );
    },
    [players, tiersEnabled, tierBreaks, commitPlayers],
  );

  /** Drag a player onto another's slot. A drag never changes a line: the
   * lines stay at their ranks and the players move past them. */
  const reorderByDrag = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const fromIndex = players.findIndex((x) => x.playerId === fromId);
      const toIndex = players.findIndex((x) => x.playerId === toId);
      if (fromIndex < 0 || toIndex < 0) return;
      const next = [...players];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      commitPlayers(next, `${moved.name} moved to rank ${toIndex + 1}.`);
    },
    [players, commitPlayers],
  );

  // ----- tier lines ------------------------------------------------------
  const lineAnnouncement = (tier: number, startRank: number) =>
    `Tier ${tier} now starts at rank ${startRank}, ${players[startRank - 1]?.name ?? ""}.`;

  const addLine = (rank: number) => {
    const next = addTierBreak(tierBreaks, rank, players.length);
    if (next.length === tierBreaks.length) return;
    const labels = shiftLabelsForAddedBreak(tierLabels, tierBreaks, rank);
    setTierBreaks(next);
    setTierLabels(labels);
    saveMeta({ tierLabels: labels });
    const tier = tierForRank(next, rank + 1);
    setAnnouncement(
      `Tier line added after rank ${rank}. ${lineAnnouncement(tier, rank + 1)} There are now ${next.length + 1} tiers.`,
    );
    schedulePlayerSave();
  };

  const moveLine = (from: number, to: number) => {
    const next = moveTierBreak(tierBreaks, from, to, players.length);
    if (!next) return;
    setTierBreaks(next);
    setAnnouncement(lineAnnouncement(tierForRank(next, to + 1), to + 1));
    schedulePlayerSave();
  };

  const removeLine = (rank: number) => {
    const labels = shiftLabelsForRemovedBreak(tierLabels, tierBreaks, rank);
    const next = removeTierBreak(tierBreaks, rank);
    setTierBreaks(next);
    setTierLabels(labels);
    saveMeta({ tierLabels: labels });
    setAnnouncement(
      `Tier line after rank ${rank} removed. There ${next.length === 0 ? "is now 1 tier" : `are now ${next.length + 1} tiers`}.`,
    );
    schedulePlayerSave();
  };

  const toggleTiers = (enabled: boolean) => {
    setTiersEnabled(enabled);
    saveMeta({ tiersEnabled: enabled });
    setAnnouncement(
      enabled
        ? `Tiers shown. ${tierBreaks.length === 0 ? "Add a tier line to split the board." : `${tierBreaks.length + 1} tiers.`}`
        : "Tiers hidden. Your tier lines are kept.",
    );
  };

  const renameTier = (tier: number, label: string) => {
    const next = { ...tierLabels, [String(tier)]: label };
    if (label.trim().length === 0) delete next[String(tier)];
    setTierLabels(next);
    saveMeta({ tierLabels: next });
  };

  const commitName = (value: string) => {
    const cleaned = value.trim().slice(0, MAX_BOARD_NAME_LENGTH);
    if (cleaned.length === 0) {
      setName(initialName);
      return;
    }
    setName(cleaned);
    saveMeta({ name: cleaned });
  };

  const excludeIds = useMemo(() => new Set(players.map((p) => p.playerId)), [players]);
  const ranks = useMemo(() => computeBoardRanks(players), [players]);

  // Comparable ranks per comparison (positional on a one-position board, rank
  // among offensive players on an overall one; see lib/ranking-boards/compare).
  const comparisonRanks = useMemo(
    () => comparisons.map((c) => readerRanksFor(players, c)),
    [comparisons, players],
  );

  // Only multi-position boards get positional ranks and filters.
  const supportsPositionViews = !isSinglePositionScope(scope);

  const positionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    players.forEach((p) => counts.set(p.position, (counts.get(p.position) ?? 0) + 1));
    return counts;
  }, [players]);

  const filterPositions = useMemo(
    () => BOARD_POSITIONS.filter((pos) => (positionCounts.get(pos) ?? 0) > 0),
    [positionCounts],
  );

  const activeFilter: PositionFilter = supportsPositionViews ? positionFilter : "all";
  const isFiltered = activeFilter !== "all";

  // An import can replace the board while a filter is active, leaving the
  // filter pointed at a position that is gone. Release it, or the board would
  // sit read-only with no control left to clear it.
  useEffect(() => {
    if (
      positionFilter !== "all" &&
      (filterPositions.length <= 1 || !filterPositions.includes(positionFilter))
    ) {
      setPositionFilter("all");
    }
  }, [positionFilter, filterPositions]);

  const visiblePlayers = useMemo(
    () => (isFiltered ? players.filter((p) => p.position === activeFilter) : players),
    [players, isFiltered, activeFilter],
  );

  const changeFilter = (next: PositionFilter) => {
    setPositionFilter(next);
    const total = players.length;
    const count = next === "all" ? total : positionCounts.get(next) ?? 0;
    setAnnouncement(
      next === "all"
        ? `Showing all ${total} player${total === 1 ? "" : "s"}. Reordering is back on.`
        : `Showing ${count} ${positionNoun(next, count === 1 ? "singular" : "plural")}. Reordering is off.`,
    );
  };

  // ----- drag ------------------------------------------------------------
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const endDrag = () => {
    setDrag(null);
    setOverId(null);
  };
  const dropOn = (playerId: string) => {
    if (!drag) return;
    if (drag.kind === "player") {
      reorderByDrag(drag.id, playerId);
    } else {
      const rank = players.findIndex((p) => p.playerId === playerId) + 1;
      moveLine(drag.rank, rank);
    }
    endDrag();
  };

  const rowProps = (player: BoardPlayer, index: number) => {
    const rank = ranks.get(player.playerId);
    const overall = rank?.overall ?? index + 1;
    return {
      player,
      rank: overall,
      positionRank: supportsPositionViews ? rank?.positionRank ?? null : null,
      tier: tiersEnabled ? tierForRank(tierBreaks, overall) : null,
      isFirst: overall === 1,
      isLast: overall === players.length,
      readOnly: isFiltered,
      canAddLineBelow:
        tiersEnabled && !isFiltered && overall < players.length && !tierBreaks.includes(overall),
      comparisons: comparisons.map((c, i) => ({
        comparison: c,
        gap: rankGap(c, player, comparisonRanks[i].get(player.playerId)),
      })),
      isDragging: drag?.kind === "player" && drag.id === player.playerId,
      isDropTarget: overId === player.playerId,
      onMove: movePlayer,
      onRemove: removePlayer,
      onAddLineBelow: addLine,
      onDragStart: () => setDrag({ kind: "player", id: player.playerId }),
      onDragEnterRow: () => setOverId(player.playerId),
      onDragEndRow: endDrag,
      onDropRow: () => dropOn(player.playerId),
    } satisfies PlayerRowProps;
  };

  const ranges = tiersEnabled && !isFiltered ? tierRanges(tierBreaks, players.length) : null;

  return (
    <div className="space-y-8">
      <BoardHeader
        name={name}
        scope={scope}
        includesDefenders={includesDefenders}
        playerCount={players.length}
        saveState={saveState}
        onCommitName={commitName}
      />

      {/* Live region: structural changes are announced politely. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <CommunityPanel
        boardId={boardId}
        initialOptOut={community.optOut}
        playerCount={players.length}
        minPlayers={community.minPlayers}
        hasFormat={community.hasFormat}
        formats={community.formats}
      />

      <TierControls
        tiersEnabled={tiersEnabled}
        tierCount={tierBreaks.length + 1}
        players={players}
        tierBreaks={tierBreaks}
        onToggle={toggleTiers}
        onAddLine={addLine}
      />

      <ImportFromRankings
        scope={scope}
        sources={importSources}
        formats={importFormats}
        defaultSourceSlug={defaultSourceSlug}
        defaultFormatSlug={boardFormatSlug}
        currentPlayerCount={players.length}
        onImport={importRankings}
      />

      <AddPlayerCombobox
        positions={boardPositions}
        holdsDefenders={holdsDefenders}
        excludeIds={excludeIds}
        onAdd={addPlayer}
      />

      {supportsPositionViews && filterPositions.length > 1 && (
        <PositionFilterBar
          positions={filterPositions}
          counts={positionCounts}
          active={activeFilter}
          totalCount={players.length}
          visibleCount={visiblePlayers.length}
          listId={listId}
          onChange={changeFilter}
        />
      )}

      <div id={listId}>
        {players.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-base/40 p-6 text-sm text-ink-muted">
            No players on this board yet. Build it by comparing, import our rankings, or search
            above to add your first one.
          </p>
        ) : ranges ? (
          <div className="space-y-4">
            {ranges.map((range) => {
              const headingId = `${listId}-tier-${range.tier}`;
              const custom = tierLabels[String(range.tier)]?.trim() || null;
              const lineRank = range.start - 1;
              return (
                <section
                  key={range.tier}
                  aria-labelledby={headingId}
                  onDragOver={(event) => {
                    if (drag?.kind === "break") event.preventDefault();
                  }}
                >
                  <TierBreakLine tier={range.tier} label={custom} headingLevel={3} id={headingId}>
                    <TierLabelInput
                      tier={range.tier}
                      value={tierLabels[String(range.tier)] ?? ""}
                      onCommit={renameTier}
                    />
                    {range.tier > 1 && (
                      <TierBreakLineControls
                        tier={range.tier}
                        rank={lineRank}
                        players={players}
                        breaks={tierBreaks}
                        onMove={moveLine}
                        onRemove={removeLine}
                        onDragStart={(rank) => setDrag({ kind: "break", rank })}
                        onDragEnd={endDrag}
                      />
                    )}
                  </TierBreakLine>
                  <p className="sr-only">
                    Ranks {range.start} to {range.end}.
                  </p>
                  <ol start={range.start} className="flex flex-col gap-2">
                    {players.slice(range.start - 1, range.end).map((player, i) => (
                      <PlayerRow key={player.playerId} {...rowProps(player, range.start - 1 + i)} />
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {visiblePlayers.map((player, i) => (
              <PlayerRow key={player.playerId} {...rowProps(player, i)} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* ---------------- Header ---------------- */

function BoardHeader({
  name,
  scope,
  includesDefenders,
  playerCount,
  saveState,
  onCommitName,
}: {
  name: string;
  scope: BoardScope;
  includesDefenders: boolean;
  playerCount: number;
  saveState: "idle" | "saving" | "saved" | "error";
  onCommitName: (value: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const inputId = useId();
  useEffect(() => setDraft(name), [name]);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-1">
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan"
        >
          Board name
        </label>
        <input
          id={inputId}
          value={draft}
          maxLength={MAX_BOARD_NAME_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onCommitName(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          className="mt-2 w-full max-w-xl rounded-card border border-transparent bg-transparent px-0 py-1 text-2xl font-semibold tracking-tight text-ink hover:border-line focus:border-brand-purple focus:bg-base focus:px-3 focus:outline-none sm:text-3xl"
        />
        <p className="mt-1 text-sm text-ink-muted">
          {scopeLabel(scope, includesDefenders)} board, {playerCount} player
          {playerCount === 1 ? "" : "s"}.
        </p>
      </div>
      <SaveIndicator state={saveState} />
    </div>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const map = {
    idle: { text: "All changes saved", tone: "text-ink-subtle" },
    saving: { text: "Saving...", tone: "text-ink-muted" },
    saved: { text: "Saved", tone: "text-signal-success" },
    error: { text: "Save failed, retrying on next change", tone: "text-signal-danger" },
  } as const;
  const { text, tone } = map[state];
  return (
    <p aria-live="polite" className={`shrink-0 text-xs font-medium ${tone}`}>
      {text}
    </p>
  );
}

/* ---------------- Tier controls ---------------- */

function TierControls({
  tiersEnabled,
  tierCount,
  players,
  tierBreaks,
  onToggle,
  onAddLine,
}: {
  tiersEnabled: boolean;
  tierCount: number;
  players: readonly BoardPlayer[];
  tierBreaks: readonly number[];
  onToggle: (enabled: boolean) => void;
  onAddLine: (rank: number) => void;
}) {
  const switchId = useId();
  const hintId = useId();
  return (
    <div className="space-y-4 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={tiersEnabled}
            aria-describedby={hintId}
            onClick={() => onToggle(!tiersEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
              tiersEnabled ? "border-brand-purple bg-brand-purple/30" : "border-line bg-base"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-4 w-4 transform rounded-full bg-ink transition-transform ${
                tiersEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <label htmlFor={switchId} className="flex items-center gap-2 text-sm font-medium text-ink">
            <Layers aria-hidden="true" className="h-4 w-4 text-brand-purple" />
            Tiers
          </label>
        </div>
        {tiersEnabled && (
          <span className="text-sm text-ink-muted">
            {tierCount} tier{tierCount === 1 ? "" : "s"}
          </span>
        )}
        <p id={hintId} className="text-xs text-ink-subtle">
          {tiersEnabled
            ? "A tier line sits after a rank. It stays at that rank when players move past it."
            : "Turn on tiers to draw lines that split the board into bands."}
        </p>
      </div>
      {tiersEnabled && (
        <AddTierBreakForm players={players} breaks={tierBreaks} onAdd={onAddLine} />
      )}
    </div>
  );
}

function TierLabelInput({
  tier,
  value,
  onCommit,
}: {
  tier: number;
  value: string;
  onCommit: (tier: number, label: string) => void;
}) {
  const inputId = useId();
  return (
    <>
      <label htmlFor={inputId} className="sr-only">
        Tier {tier} label
      </label>
      <input
        id={inputId}
        key={`${tier}:${value}`}
        defaultValue={value}
        placeholder="Add a label"
        maxLength={40}
        onBlur={(event) => {
          if (event.target.value !== value) onCommit(tier, event.target.value);
        }}
        className="h-11 w-36 rounded-card border border-transparent bg-transparent px-2 text-base text-ink hover:border-line focus:border-brand-purple focus:bg-base focus:outline-none sm:h-8 sm:text-sm"
      />
    </>
  );
}

/* ---------------- Player row ---------------- */

type PlayerRowProps = {
  player: BoardPlayer;
  rank: number;
  /** Rank among same-position players, or null on a one-position board
   * (where it would just repeat the rank). */
  positionRank: number | null;
  /** The player's tier when tiers are shown. */
  tier: number | null;
  isFirst: boolean;
  isLast: boolean;
  readOnly: boolean;
  canAddLineBelow: boolean;
  comparisons: { comparison: RankComparison; gap: ReturnType<typeof rankGap> }[];
  isDragging: boolean;
  isDropTarget: boolean;
  onMove: (playerId: string, direction: "up" | "down") => void;
  onRemove: (playerId: string) => void;
  onAddLineBelow: (rank: number) => void;
  onDragStart: () => void;
  onDragEnterRow: () => void;
  onDragEndRow: () => void;
  onDropRow: () => void;
};

const rowButton =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30 sm:h-9 sm:w-9";

function PlayerRow({
  player,
  rank,
  positionRank,
  tier,
  isFirst,
  isLast,
  readOnly,
  canAddLineBelow,
  comparisons,
  isDragging,
  isDropTarget,
  onMove,
  onRemove,
  onAddLineBelow,
  onDragStart,
  onDragEnterRow,
  onDragEndRow,
  onDropRow,
}: PlayerRowProps) {
  const dragProps = readOnly
    ? {}
    : {
        draggable: true,
        onDragStart: (event: React.DragEvent<HTMLLIElement>) => {
          event.dataTransfer.effectAllowed = "move";
          onDragStart();
        },
        onDragOver: (event: React.DragEvent<HTMLLIElement>) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        },
        onDragEnter: onDragEnterRow,
        onDragEnd: onDragEndRow,
        onDrop: (event: React.DragEvent<HTMLLIElement>) => {
          event.preventDefault();
          onDropRow();
        },
      };

  return (
    <li
      {...dragProps}
      className={`flex flex-col gap-2 rounded-card border bg-base p-2.5 transition-colors sm:flex-row sm:items-center sm:gap-3 ${
        isDropTarget
          ? "border-brand-cyan"
          : isDragging
            ? "border-brand-purple/60 opacity-60"
            : "border-line"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {!readOnly && (
          <span aria-hidden="true" title="Drag to reorder" className="hidden cursor-grab text-ink-subtle sm:block">
            <GripVertical className="h-4 w-4" />
          </span>
        )}

        {/* One real text node per figure; only the missing words are sr-only. */}
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="w-7 text-center font-mono text-sm tabular-nums text-ink-subtle">
            <span className="sr-only">Rank </span>
            {rank}
            {tier != null && <span className="sr-only">, tier {tier}</span>}
          </span>
          {positionRank != null && (
            <span className="rounded-full border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-brand-cyan">
              <span className="sr-only">, {positionNoun(player.position)} rank </span>
              <span aria-hidden="true">{player.position}</span>
              {positionRank}
            </span>
          )}
        </span>

        <PlayerHeadshot sleeperId={player.sleeperId} position={player.position} name={player.name} size={36} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{player.name}</p>
          <p className="truncate text-xs text-ink-subtle">
            {player.position}
            {player.team ? `, ${player.team}` : ""}
          </p>
        </div>

        {comparisons.length > 0 && (
          <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
            {comparisons.map(({ comparison, gap }) => (
              <span key={comparison.label} className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.1em] text-ink-subtle">
                  {comparison.label}
                </span>
                <RankGapChip gap={gap} subject={comparison.subject} />
              </span>
            ))}
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="flex items-center justify-end gap-1.5 sm:shrink-0 sm:gap-1">
          <button
            type="button"
            onClick={() => onMove(player.playerId, "up")}
            disabled={isFirst}
            aria-label={`Move ${player.name} up`}
            className={rowButton}
          >
            <ChevronUp aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(player.playerId, "down")}
            disabled={isLast}
            aria-label={`Move ${player.name} down`}
            className={rowButton}
          >
            <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </button>
          {canAddLineBelow && (
            <button
              type="button"
              onClick={() => onAddLineBelow(rank)}
              aria-label={`Add a tier line below ${player.name}`}
              title="Add a tier line below"
              className={rowButton}
            >
              <SeparatorHorizontal aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(player.playerId)}
            aria-label={`Remove ${player.name} from the board`}
            className={`${rowButton} hover:border-signal-danger/60 hover:text-signal-danger`}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
    </li>
  );
}
