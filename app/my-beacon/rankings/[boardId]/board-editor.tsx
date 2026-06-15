"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Layers,
  Plus,
  X,
} from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_BOARD_NAME_LENGTH,
  MAX_TIERS,
  scopeLabel,
  tierLabel,
  type BoardPlayer,
  type BoardScope,
  type SearchablePlayer,
} from "@/lib/ranking-boards";

const SAVE_DEBOUNCE_MS = 700;
const SEARCH_DEBOUNCE_MS = 250;
const FETCH_HEADERS = { "x-requested-with": "ff-beacon" } as const;

export function BoardEditor({
  boardId,
  initialName,
  scope,
  initialTiersEnabled,
  initialTierCount,
  initialTierLabels,
  initialPlayers,
}: {
  boardId: string;
  initialName: string;
  scope: BoardScope;
  initialTiersEnabled: boolean;
  initialTierCount: number;
  initialTierLabels: Record<string, string>;
  initialPlayers: BoardPlayer[];
}) {
  const supabase = useMemo(() => createClient(), []);

  const [name, setName] = useState(initialName);
  const [tiersEnabled, setTiersEnabled] = useState(initialTiersEnabled);
  const [tierCount, setTierCount] = useState(initialTierCount);
  const [tierLabels, setTierLabels] =
    useState<Record<string, string>>(initialTierLabels);
  const [players, setPlayers] = useState<BoardPlayer[]>(initialPlayers);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  // Polite, human announcement of the most recent structural change, for
  // screen readers (the visual list updates instantly for sighted users).
  const [announcement, setAnnouncement] = useState("");

  // ----- persistence plumbing -------------------------------------------
  // Player rows removed since the last flush; deleted by player_id on save.
  const pendingRemovals = useRef<Set<string>>(new Set());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always read the freshest players inside the debounced flush.
  const playersRef = useRef(players);
  playersRef.current = players;

  const flushPlayers = useCallback(async () => {
    const snapshot = playersRef.current;
    const removals = Array.from(pendingRemovals.current);
    pendingRemovals.current = new Set();
    setSaveState("saving");
    try {
      if (removals.length > 0) {
        const { error } = await supabase
          .from("user_ranking_board_players")
          .delete()
          .eq("board_id", boardId)
          .in("player_id", removals);
        if (error) throw error;
      }
      if (snapshot.length > 0) {
        const rows = snapshot.map((p, index) => ({
          board_id: boardId,
          player_id: p.playerId,
          rank_position: index + 1,
          tier: tiersEnabled ? p.tier : null,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase
          .from("user_ranking_board_players")
          .upsert(rows, { onConflict: "board_id,player_id" });
        if (error) throw error;
      }
      setSaveState("saved");
    } catch {
      // Re-queue the removals we pulled so they aren't lost on a transient error.
      removals.forEach((id) => pendingRemovals.current.add(id));
      setSaveState("error");
    }
  }, [supabase, boardId, tiersEnabled]);

  const schedulePlayerSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
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
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMeta = useCallback(
    (patch: Record<string, unknown>) => {
      if (metaTimer.current) clearTimeout(metaTimer.current);
      metaTimer.current = setTimeout(async () => {
        setSaveState("saving");
        const { error } = await supabase
          .from("user_ranking_boards")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", boardId);
        setSaveState(error ? "error" : "saved");
      }, SAVE_DEBOUNCE_MS);
    },
    [supabase, boardId],
  );

  // ----- mutations -------------------------------------------------------
  const addPlayer = useCallback(
    (p: SearchablePlayer) => {
      setPlayers((prev) => {
        if (prev.some((x) => x.playerId === p.playerId)) return prev;
        pendingRemovals.current.delete(p.playerId);
        const next: BoardPlayer = {
          rowId: null,
          playerId: p.playerId,
          slug: p.slug,
          name: p.name,
          position: p.position,
          team: p.team,
          sleeperId: p.sleeperId,
          tier: null,
        };
        return [...prev, next];
      });
      setAnnouncement(`Added ${p.name} to the board.`);
      schedulePlayerSave();
    },
    [schedulePlayerSave],
  );

  const removePlayer = useCallback(
    (playerId: string) => {
      setPlayers((prev) => {
        const target = prev.find((x) => x.playerId === playerId);
        if (target) {
          pendingRemovals.current.add(playerId);
          setAnnouncement(`Removed ${target.name} from the board.`);
        }
        return prev.filter((x) => x.playerId !== playerId);
      });
      schedulePlayerSave();
    },
    [schedulePlayerSave],
  );

  /** Move within the relevant neighbour set: same-tier members when tiers are
   * on, otherwise the whole list. */
  const movePlayer = useCallback(
    (playerId: string, direction: "up" | "down") => {
      setPlayers((prev) => {
        const index = prev.findIndex((x) => x.playerId === playerId);
        if (index < 0) return prev;
        const player = prev[index];
        // Candidate neighbour indices in the chosen direction.
        const step = direction === "up" ? -1 : 1;
        let swapWith = -1;
        for (let i = index + step; i >= 0 && i < prev.length; i += step) {
          if (!tiersEnabled || prev[i].tier === player.tier) {
            swapWith = i;
            break;
          }
        }
        if (swapWith < 0) return prev;
        const next = [...prev];
        [next[index], next[swapWith]] = [next[swapWith], next[index]];
        return next;
      });
      schedulePlayerSave();
    },
    [tiersEnabled, schedulePlayerSave],
  );

  /** Assign a tier (or null) and drop the player at the end of that group. */
  const assignTier = useCallback(
    (playerId: string, tier: number | null) => {
      setPlayers((prev) => {
        const index = prev.findIndex((x) => x.playerId === playerId);
        if (index < 0) return prev;
        const moved = { ...prev[index], tier };
        const without = prev.filter((x) => x.playerId !== playerId);
        return [...without, moved];
      });
      setAnnouncement(
        tier === null
          ? "Moved to no tier."
          : `Moved to ${tierLabel(tierLabels, tier)}.`,
      );
      schedulePlayerSave();
    },
    [tierLabels, schedulePlayerSave],
  );

  /** Reorder via drag: move `fromId` to sit at `toId`'s slot, adopting its
   * tier when tiers are on so cross-group drags change tier intuitively. */
  const reorderByDrag = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      setPlayers((prev) => {
        const fromIndex = prev.findIndex((x) => x.playerId === fromId);
        const toIndex = prev.findIndex((x) => x.playerId === toId);
        if (fromIndex < 0 || toIndex < 0) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        if (tiersEnabled) moved.tier = prev[toIndex].tier;
        const insertAt = next.findIndex((x) => x.playerId === toId);
        next.splice(insertAt, 0, moved);
        return next;
      });
      schedulePlayerSave();
    },
    [tiersEnabled, schedulePlayerSave],
  );

  // ----- tier controls ---------------------------------------------------
  const toggleTiers = (enabled: boolean) => {
    setTiersEnabled(enabled);
    saveMeta({ tiers_enabled: enabled });
    setAnnouncement(enabled ? "Tiers enabled." : "Tiers disabled.");
    // Re-persist player rows so tier values are written/cleared to match.
    schedulePlayerSave();
  };

  const addTier = () => {
    setTierCount((prev) => {
      const next = Math.min(MAX_TIERS, prev + 1);
      saveMeta({ tier_count: next });
      return next;
    });
  };

  const removeTier = () => {
    setTierCount((prev) => {
      const next = Math.max(1, prev - 1);
      if (next !== prev) {
        // Any player parked in a now-removed tier drops back to "no tier".
        setPlayers((cur) =>
          cur.map((p) => (p.tier && p.tier > next ? { ...p, tier: null } : p)),
        );
        saveMeta({ tier_count: next });
        schedulePlayerSave();
      }
      return next;
    });
  };

  const renameTier = (tier: number, label: string) => {
    setTierLabels((prev) => {
      const next = { ...prev, [String(tier)]: label };
      if (label.trim().length === 0) delete next[String(tier)];
      saveMeta({ tier_labels: next });
      return next;
    });
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

  const excludeIds = useMemo(
    () => new Set(players.map((p) => p.playerId)),
    [players],
  );

  // Tier groups for rendering when tiers are on: each numbered tier plus a
  // trailing "No tier" bucket. Within-group order follows array order.
  const tierGroups = useMemo(() => {
    if (!tiersEnabled) return null;
    const groups: { tier: number | null; label: string; items: BoardPlayer[] }[] =
      [];
    for (let t = 1; t <= tierCount; t += 1) {
      groups.push({
        tier: t,
        label: tierLabel(tierLabels, t),
        items: players.filter((p) => p.tier === t),
      });
    }
    groups.push({
      tier: null,
      label: "No tier",
      items: players.filter((p) => p.tier == null),
    });
    return groups;
  }, [tiersEnabled, tierCount, tierLabels, players]);

  return (
    <div className="space-y-8">
      <BoardHeader
        name={name}
        scope={scope}
        playerCount={players.length}
        saveState={saveState}
        onCommitName={commitName}
      />

      {/* Live region: structural changes are announced politely. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <TierControls
        tiersEnabled={tiersEnabled}
        tierCount={tierCount}
        onToggle={toggleTiers}
        onAddTier={addTier}
        onRemoveTier={removeTier}
      />

      <AddPlayerCombobox
        scope={scope}
        excludeIds={excludeIds}
        onAdd={addPlayer}
      />

      {players.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-base/40 p-6 text-sm text-ink-muted">
          No players on this board yet. Search above to add your first one.
        </p>
      ) : tierGroups ? (
        <div className="space-y-6">
          {tierGroups.map((group) => (
            <TierGroup
              key={group.tier ?? "none"}
              group={group}
              tierCount={tierCount}
              tierLabels={tierLabels}
              onRenameTier={renameTier}
              onMove={movePlayer}
              onRemove={removePlayer}
              onAssignTier={assignTier}
              onReorderDrag={reorderByDrag}
            />
          ))}
        </div>
      ) : (
        <PlayerList
          players={players}
          tiersEnabled={false}
          tierCount={tierCount}
          tierLabels={tierLabels}
          onMove={movePlayer}
          onRemove={removePlayer}
          onAssignTier={assignTier}
          onReorderDrag={reorderByDrag}
        />
      )}
    </div>
  );
}

/* ---------------- Header ---------------- */

function BoardHeader({
  name,
  scope,
  playerCount,
  saveState,
  onCommitName,
}: {
  name: string;
  scope: BoardScope;
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
        <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
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
          className="mt-1 w-full max-w-xl rounded-card border border-transparent bg-transparent px-0 py-1 text-2xl font-semibold tracking-tight text-ink hover:border-line focus:border-brand-purple focus:bg-base focus:px-3 focus:outline-none sm:text-3xl"
        />
        <p className="mt-1 text-sm text-ink-muted">
          {scopeLabel(scope)} board, {playerCount} player
          {playerCount === 1 ? "" : "s"}.
        </p>
      </div>
      <SaveIndicator state={saveState} />
    </div>
  );
}

function SaveIndicator({
  state,
}: {
  state: "idle" | "saving" | "saved" | "error";
}) {
  const map = {
    idle: { text: "All changes saved", tone: "text-ink-subtle" },
    saving: { text: "Saving...", tone: "text-ink-muted" },
    saved: { text: "Saved", tone: "text-signal-success" },
    error: { text: "Save failed, retrying on next change", tone: "text-signal-danger" },
  } as const;
  const { text, tone } = map[state];
  return (
    <p
      aria-live="polite"
      className={`shrink-0 text-xs font-medium ${tone}`}
    >
      {text}
    </p>
  );
}

/* ---------------- Tier controls ---------------- */

function TierControls({
  tiersEnabled,
  tierCount,
  onToggle,
  onAddTier,
  onRemoveTier,
}: {
  tiersEnabled: boolean;
  tierCount: number;
  onToggle: (enabled: boolean) => void;
  onAddTier: () => void;
  onRemoveTier: () => void;
}) {
  const switchId = useId();
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={tiersEnabled}
          onClick={() => onToggle(!tiersEnabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
            tiersEnabled
              ? "border-brand-purple bg-brand-purple/30"
              : "border-line bg-base"
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
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">{tierCount} tiers</span>
          <button
            type="button"
            onClick={onRemoveTier}
            disabled={tierCount <= 1}
            aria-label="Remove the last tier"
            className="inline-flex h-8 w-8 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
          >
            <span aria-hidden="true">-</span>
          </button>
          <button
            type="button"
            onClick={onAddTier}
            disabled={tierCount >= MAX_TIERS}
            aria-label="Add a tier"
            className="inline-flex h-8 w-8 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
      <p className="text-xs text-ink-subtle">
        {tiersEnabled
          ? "Group players into tiers. Use each row's tier menu or drag a player into a tier."
          : "Turn on tiers to group players into named bands."}
      </p>
    </div>
  );
}

/* ---------------- Tier group ---------------- */

function TierGroup({
  group,
  tierCount,
  tierLabels,
  onRenameTier,
  onMove,
  onRemove,
  onAssignTier,
  onReorderDrag,
}: {
  group: { tier: number | null; label: string; items: BoardPlayer[] };
  tierCount: number;
  tierLabels: Record<string, string>;
  onRenameTier: (tier: number, label: string) => void;
  onMove: (playerId: string, direction: "up" | "down") => void;
  onRemove: (playerId: string) => void;
  onAssignTier: (playerId: string, tier: number | null) => void;
  onReorderDrag: (fromId: string, toId: string) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-card border border-line bg-surface/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        {group.tier === null ? (
          <h3 id={headingId} className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            {group.label}
          </h3>
        ) : (
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-card border border-brand-purple/40 bg-brand-purple/10 px-2 font-mono text-sm font-semibold text-brand-purple"
            >
              {group.tier}
            </span>
            <label htmlFor={headingId} className="sr-only">
              Tier {group.tier} label
            </label>
            <input
              id={headingId}
              defaultValue={tierLabels[String(group.tier)] ?? ""}
              placeholder={`Tier ${group.tier}`}
              maxLength={40}
              onBlur={(event) => onRenameTier(group.tier as number, event.target.value)}
              className="rounded-card border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-ink hover:border-line focus:border-brand-purple focus:bg-base focus:px-2 focus:outline-none"
            />
          </div>
        )}
        <span className="text-xs text-ink-subtle">
          {group.items.length} player{group.items.length === 1 ? "" : "s"}
        </span>
      </div>
      {group.items.length === 0 ? (
        <p className="rounded-card border border-dashed border-line/60 bg-base/30 px-3 py-4 text-xs text-ink-subtle">
          Empty. Use a player&rsquo;s tier menu to move them here.
        </p>
      ) : (
        <PlayerList
          players={group.items}
          tiersEnabled
          tierCount={tierCount}
          tierLabels={tierLabels}
          onMove={onMove}
          onRemove={onRemove}
          onAssignTier={onAssignTier}
          onReorderDrag={onReorderDrag}
        />
      )}
    </section>
  );
}

/* ---------------- Player list + row ---------------- */

function PlayerList({
  players,
  tiersEnabled,
  tierCount,
  tierLabels,
  onMove,
  onRemove,
  onAssignTier,
  onReorderDrag,
}: {
  players: BoardPlayer[];
  tiersEnabled: boolean;
  tierCount: number;
  tierLabels: Record<string, string>;
  onMove: (playerId: string, direction: "up" | "down") => void;
  onRemove: (playerId: string) => void;
  onAssignTier: (playerId: string, tier: number | null) => void;
  onReorderDrag: (fromId: string, toId: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  return (
    <ol role="list" className="flex flex-col gap-2">
      {players.map((player, index) => (
        <PlayerRow
          key={player.playerId}
          player={player}
          position={index + 1}
          isFirst={index === 0}
          isLast={index === players.length - 1}
          tiersEnabled={tiersEnabled}
          tierCount={tierCount}
          tierLabels={tierLabels}
          isDragging={dragId === player.playerId}
          isDropTarget={overId === player.playerId && dragId !== player.playerId}
          onMove={onMove}
          onRemove={onRemove}
          onAssignTier={onAssignTier}
          onDragStart={() => setDragId(player.playerId)}
          onDragEnterRow={() => setOverId(player.playerId)}
          onDragEndRow={() => {
            setDragId(null);
            setOverId(null);
          }}
          onDropRow={() => {
            if (dragId) onReorderDrag(dragId, player.playerId);
            setDragId(null);
            setOverId(null);
          }}
        />
      ))}
    </ol>
  );
}

function PlayerRow({
  player,
  position,
  isFirst,
  isLast,
  tiersEnabled,
  tierCount,
  tierLabels,
  isDragging,
  isDropTarget,
  onMove,
  onRemove,
  onAssignTier,
  onDragStart,
  onDragEnterRow,
  onDragEndRow,
  onDropRow,
}: {
  player: BoardPlayer;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  tiersEnabled: boolean;
  tierCount: number;
  tierLabels: Record<string, string>;
  isDragging: boolean;
  isDropTarget: boolean;
  onMove: (playerId: string, direction: "up" | "down") => void;
  onRemove: (playerId: string) => void;
  onAssignTier: (playerId: string, tier: number | null) => void;
  onDragStart: () => void;
  onDragEnterRow: () => void;
  onDragEndRow: () => void;
  onDropRow: () => void;
}) {
  const tierSelectId = useId();
  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={onDragEnterRow}
      onDragEnd={onDragEndRow}
      onDrop={(event) => {
        event.preventDefault();
        onDropRow();
      }}
      className={`flex items-center gap-3 rounded-card border bg-base p-2.5 transition-colors ${
        isDropTarget
          ? "border-brand-cyan"
          : isDragging
            ? "border-brand-purple/60 opacity-60"
            : "border-line"
      }`}
    >
      <span
        aria-hidden="true"
        title="Drag to reorder"
        className="hidden cursor-grab text-ink-subtle sm:block"
      >
        <GripVertical className="h-4 w-4" />
      </span>

      <span className="w-6 shrink-0 text-center font-mono text-sm tabular-nums text-ink-subtle">
        {position}
      </span>

      <PlayerHeadshot
        sleeperId={player.sleeperId}
        position={player.position}
        name={player.name}
        size={36}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{player.name}</p>
        <p className="truncate text-xs text-ink-subtle">
          {player.position}
          {player.team ? ` · ${player.team}` : ""}
        </p>
      </div>

      {tiersEnabled && (
        <div className="shrink-0">
          <label htmlFor={tierSelectId} className="sr-only">
            Tier for {player.name}
          </label>
          <select
            id={tierSelectId}
            value={player.tier ?? ""}
            onChange={(event) =>
              onAssignTier(
                player.playerId,
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
            className="h-9 rounded-card border border-line bg-surface px-2 text-xs text-ink focus:border-brand-purple focus:outline-none"
          >
            <option value="">No tier</option>
            {Array.from({ length: tierCount }, (_, i) => i + 1).map((t) => (
              <option key={t} value={t}>
                {tierLabel(tierLabels, t)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onMove(player.playerId, "up")}
          disabled={isFirst}
          aria-label={`Move ${player.name} up`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30"
        >
          <ChevronUp aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove(player.playerId, "down")}
          disabled={isLast}
          aria-label={`Move ${player.name} down`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-card border border-line text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-30"
        >
          <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(player.playerId)}
          aria-label={`Remove ${player.name} from the board`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-card border border-line text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

/* ---------------- Add-player combobox ---------------- */

function AddPlayerCombobox({
  scope,
  excludeIds,
  onAdd,
}: {
  scope: BoardScope;
  excludeIds: Set<string>;
  onAdd: (player: SearchablePlayer) => void;
}) {
  const inputId = useId();
  const listboxId = useId();
  const helpId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchablePlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Debounced server search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (scope !== "overall") params.set("position", scope);
        const res = await fetch(`/api/players/search?${params.toString()}`, {
          headers: FETCH_HEADERS,
          signal: controller.signal,
        });
        if (!res.ok) {
          setResults([]);
        } else {
          const json = (await res.json()) as { players: SearchablePlayer[] };
          setResults(json.players ?? []);
        }
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, scope]);

  const matches = useMemo(
    () => results.filter((p) => !excludeIds.has(p.playerId)),
    [results, excludeIds],
  );

  useEffect(() => {
    if (activeIdx >= matches.length) setActiveIdx(0);
  }, [matches.length, activeIdx]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const commit = (player: SearchablePlayer) => {
    onAdd(player);
    // Keep the box open and clear the query so the user can add several in a
    // row without re-focusing.
    setQuery("");
    setResults([]);
    setActiveIdx(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (open && matches[activeIdx]) {
        event.preventDefault();
        commit(matches[activeIdx]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        Add a player
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && matches[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined
        }
        aria-describedby={helpId}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={
          scope === "overall"
            ? "Search any active player"
            : `Search active ${scope}s`
        }
        className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-base text-ink placeholder:text-ink-subtle caret-brand-purple focus:border-brand-purple focus:outline-none sm:text-sm"
      />
      <p id={helpId} className="mt-1 text-xs text-ink-subtle">
        {scope === "overall"
          ? "Type at least two letters. Active NFL players only."
          : `Type at least two letters. Active ${scope}s only.`}
      </p>

      {open && query.trim().length >= 2 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player search results"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface-elevated shadow-2xl shadow-black/50"
        >
          {loading ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">Searching...</li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">
              No active players match &ldquo;{query.trim()}&rdquo;.
            </li>
          ) : (
            matches.map((p, i) => {
              const isActive = i === activeIdx;
              return (
                <li
                  key={p.playerId}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(p);
                  }}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors ${
                    isActive ? "bg-brand-purple/15 text-ink" : "text-ink-muted"
                  }`}
                >
                  <PlayerHeadshot
                    sleeperId={p.sleeperId}
                    position={p.position}
                    name={p.name}
                    size={28}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{p.name}</span>
                    <span className="ml-2 text-xs text-ink-subtle">
                      {p.position}
                      {p.team ? ` · ${p.team}` : ""}
                    </span>
                  </span>
                  <Plus aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
