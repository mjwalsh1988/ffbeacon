"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ListOrdered,
  Plus,
  Trophy,
  Trash2,
} from "lucide-react";
import {
  type ProfileLayout,
  type SignalBlock,
  type SignalBlockType,
  PROFILE_LAYOUTS,
  TEXT_BLOCK_MAX,
  MAX_BLOCKS,
  isSingletonBlockType,
  newBlockId,
} from "@/lib/signal/blocks";
import { useAdminAnnouncer } from "@/components/admin/admin-controls";

/**
 * The Signal profile layout builder. A single one-dimensional reorderable list of
 * blocks plus a Layout A/B switch. Columns are NOT assigned here: the public page
 * auto-places blocks by type in Layout B (see lib/signal/blocks.ts blockColumn),
 * so the builder stays a simple, fully keyboard-operable move-up/down list.
 *
 * about, links, and favorites are singletons: their add buttons disable (with a
 * spoken reason) once present. about renders the bio, links/favorites render the
 * existing editors' data, board_top_n/league_card reference an entity by id, and
 * text owns its own copy (edited inline here). The public resolver drops any block
 * whose reference is gone, so removing a block here only removes the reference.
 *
 * The parent provides the persistence action (onSave) and the option lists for
 * the board/league pickers (the owner's profile_visible boards and featured
 * synced leagues); all interaction, reordering, and announcements live here. It
 * uses the shared single re-announcing live region (useAdminAnnouncer) so
 * identical consecutive messages still speak, and a separate assertive
 * role="alert" for save errors (no nested live regions, so no double-announce).
 */

export type BuilderBoardOption = { id: string; name: string };
export type BuilderLeagueOption = {
  sleeperLeagueId: string;
  name: string;
  season: number;
};

const TYPE_LABEL: Record<SignalBlockType, string> = {
  about: "About",
  text: "Text",
  links: "Links",
  favorites: "Favorites",
  board_top_n: "Ranking board",
  league_card: "League",
};

/** The add-menu order. board_top_n and league_card are added via the pickers
 * (wired by the parent), so they are not plain add buttons here. */
const ADD_MENU_TYPES: SignalBlockType[] = ["about", "text", "links", "favorites"];

export function LayoutBuilder({
  initialLayout,
  initialBlocks,
  boardOptions,
  leagueOptions,
  onSave,
}: {
  initialLayout: ProfileLayout;
  initialBlocks: SignalBlock[];
  boardOptions: BuilderBoardOption[];
  leagueOptions: BuilderLeagueOption[];
  onSave: (
    layout: ProfileLayout,
    blocks: SignalBlock[],
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [layout, setLayout] = useState<ProfileLayout>(initialLayout);
  const [blocks, setBlocks] = useState<SignalBlock[]>(initialBlocks);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<"board" | "league" | null>(null);
  const { announce, region } = useAdminAnnouncer();

  const boardName = useRef(
    new Map(boardOptions.map((b) => [b.id, b.name])),
  ).current;
  const leagueName = useRef(
    new Map(leagueOptions.map((l) => [l.sleeperLeagueId, l.name])),
  ).current;

  // After a reorder, keep focus on the move control the user pressed. If that
  // control became disabled (the block reached an end), move focus to the sibling
  // direction button for the same block so keyboard focus is never dropped.
  const moveBtnRef = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);

  // Refs so a pick can return focus to the picker trigger (or the Save button
  // when the trigger disables because nothing is left to add).
  const boardTriggerRef = useRef<HTMLButtonElement>(null);
  const leagueTriggerRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    moveBtnRef.current.get(key)?.focus();
  }, [blocks]);

  const presentSingletons = new Set(
    blocks.filter((b) => isSingletonBlockType(b.type)).map((b) => b.type),
  );

  // A board or league can be referenced by at most one block (a second block for
  // the same entity is redundant), so the pickers offer only entities not already
  // placed. The picker lists are the profile_visible boards and synced featured
  // leagues passed by the parent; selecting one never mutates the entity (it does
  // not flip a board's visibility), it only adds a reference block here.
  const referencedBoardIds = new Set(
    blocks.flatMap((b) => (b.type === "board_top_n" ? [b.boardId] : [])),
  );
  const referencedLeagueIds = new Set(
    blocks.flatMap((b) => (b.type === "league_card" ? [b.sleeperLeagueId] : [])),
  );
  const availableBoards = boardOptions.filter((b) => !referencedBoardIds.has(b.id));
  const availableLeagues = leagueOptions.filter(
    (l) => !referencedLeagueIds.has(l.sleeperLeagueId),
  );

  function labelFor(block: SignalBlock): string {
    if (block.type === "board_top_n") {
      return boardName.get(block.boardId) ?? "Ranking board (unavailable)";
    }
    if (block.type === "league_card") {
      return leagueName.get(block.sleeperLeagueId) ?? "League (unavailable)";
    }
    return TYPE_LABEL[block.type];
  }

  function addBlock(type: SignalBlockType) {
    if (blocks.length >= MAX_BLOCKS) {
      announce("You have reached the maximum number of blocks.");
      return;
    }
    if (isSingletonBlockType(type) && presentSingletons.has(type)) return;
    const block: SignalBlock =
      type === "text"
        ? { id: newBlockId(), type: "text", text: "" }
        : type === "about"
          ? { id: newBlockId(), type: "about" }
          : type === "links"
            ? { id: newBlockId(), type: "links" }
            : { id: newBlockId(), type: "favorites" };
    setBlocks((prev) => [...prev, block]);
    announce(`Added ${TYPE_LABEL[type]} block.`);
  }

  function addBoardBlock(boardId: string) {
    if (blocks.length >= MAX_BLOCKS || referencedBoardIds.has(boardId)) return;
    setBlocks((prev) => [...prev, { id: newBlockId(), type: "board_top_n", boardId }]);
    setOpenPicker(null);
    announce(`Added ${boardName.get(boardId) ?? "ranking board"} block.`);
    // After the last board is placed the trigger disables, so send focus to Save.
    focusAfterRender(
      availableBoards.length <= 1 ? saveRef.current : boardTriggerRef.current,
    );
  }

  function addLeagueBlock(sleeperLeagueId: string) {
    if (blocks.length >= MAX_BLOCKS || referencedLeagueIds.has(sleeperLeagueId)) {
      return;
    }
    setBlocks((prev) => [
      ...prev,
      { id: newBlockId(), type: "league_card", sleeperLeagueId },
    ]);
    setOpenPicker(null);
    announce(`Added ${leagueName.get(sleeperLeagueId) ?? "league"} block.`);
    focusAfterRender(
      availableLeagues.length <= 1 ? saveRef.current : leagueTriggerRef.current,
    );
  }

  function removeBlock(block: SignalBlock) {
    setBlocks((prev) => prev.filter((b) => b.id !== block.id));
    announce(`Removed ${labelFor(block)} block.`);
  }

  function move(block: SignalBlock, dir: -1 | 1) {
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === block.id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      announce(`Moved ${labelFor(block)} to position ${target + 1} of ${next.length}.`);
      // If the block landed at an end, the pressed direction button disables;
      // focus the opposite direction button for the same block instead.
      const landedAtTop = target === 0;
      const landedAtBottom = target === next.length - 1;
      if ((dir === -1 && landedAtTop) || (dir === 1 && landedAtBottom)) {
        pendingFocus.current = `${dir === -1 ? "down" : "up"}:${block.id}`;
      } else {
        pendingFocus.current = `${dir === -1 ? "up" : "down"}:${block.id}`;
      }
      return next;
    });
  }

  function setText(id: string, text: string) {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id && b.type === "text"
          ? { ...b, text: text.slice(0, TEXT_BLOCK_MAX) }
          : b,
      ),
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await onSave(layout, blocks);
      if (result.ok) {
        announce("Layout saved.");
      } else {
        setError(result.error ?? "Could not save your layout. Please try again.");
      }
    } catch {
      setError("Could not save your layout. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Layout A/B switch */}
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Profile layout</legend>
        <p className="mt-1 text-sm text-ink-muted">
          Layout B adds a sidebar: rankings and leagues stay in the main column,
          while about, text, links, and favorites move to the sidebar.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-4">
          {PROFILE_LAYOUTS.map((value) => (
            <LayoutRadio
              key={value}
              value={value}
              checked={layout === value}
              onChange={() => {
                setLayout(value);
                announce(
                  value === "sidebar"
                    ? "Layout B, with a sidebar, selected."
                    : "Layout A, single column, selected.",
                );
              }}
            />
          ))}
        </div>
      </fieldset>

      {/* Add menu */}
      <div role="group" aria-label="Add a block" className="flex flex-wrap gap-2">
        {ADD_MENU_TYPES.map((type) => {
          const isSingleton = isSingletonBlockType(type);
          const present = isSingleton && presentSingletons.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => addBlock(type)}
              disabled={present}
              aria-label={
                present
                  ? `${TYPE_LABEL[type]} is already on your profile`
                  : `Add ${TYPE_LABEL[type]} block`
              }
              title={
                present ? `${TYPE_LABEL[type]} is already on your profile` : undefined
              }
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
              {TYPE_LABEL[type]}
            </button>
          );
        })}

        <PickerTrigger
          triggerRef={boardTriggerRef}
          icon={<ListOrdered aria-hidden="true" className="h-4 w-4 text-brand-purple" />}
          label="Ranking board"
          panelId="signal-board-picker"
          open={openPicker === "board"}
          disabled={availableBoards.length === 0}
          disabledLabel={
            boardOptions.length === 0
              ? "No featured ranking boards to add. Feature a board in My Rankings first."
              : "All your featured boards are already on your profile"
          }
          onToggle={() =>
            setOpenPicker((cur) => (cur === "board" ? null : "board"))
          }
        />
        <PickerTrigger
          triggerRef={leagueTriggerRef}
          icon={<Trophy aria-hidden="true" className="h-4 w-4 text-brand-cyan" />}
          label="League"
          panelId="signal-league-picker"
          open={openPicker === "league"}
          disabled={availableLeagues.length === 0}
          disabledLabel={
            leagueOptions.length === 0
              ? "No featured leagues to add. Feature a league above first."
              : "All your featured leagues are already on your profile"
          }
          onToggle={() =>
            setOpenPicker((cur) => (cur === "league" ? null : "league"))
          }
        />
      </div>

      {openPicker === "board" && (
        <PickerPanel
          id="signal-board-picker"
          legend="Add a ranking board"
          items={availableBoards.map((b) => ({ key: b.id, label: b.name }))}
          onPick={addBoardBlock}
          onClose={() => {
            setOpenPicker(null);
            focusAfterRender(boardTriggerRef.current);
          }}
        />
      )}
      {openPicker === "league" && (
        <PickerPanel
          id="signal-league-picker"
          legend="Add a league"
          items={availableLeagues.map((l) => ({
            key: l.sleeperLeagueId,
            label: `${l.name}, ${l.season}`,
          }))}
          onPick={addLeagueBlock}
          onClose={() => {
            setOpenPicker(null);
            focusAfterRender(leagueTriggerRef.current);
          }}
        />
      )}

      {/* Block list */}
      {blocks.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-center text-sm text-ink-muted">
          No blocks yet. Add one above to start building your profile.
        </p>
      ) : (
        <ol role="list" className="flex flex-col gap-2">
          {blocks.map((block, index) => (
            <li
              key={block.id}
              className="rounded-card border border-line bg-surface p-3 sm:p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {labelFor(block)}
                  </p>
                  <p className="mt-0.5 text-xs uppercase tracking-[0.1em] text-ink-muted">
                    {TYPE_LABEL[block.type]}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <MoveButton
                    direction="up"
                    disabled={index === 0}
                    label={`Move ${labelFor(block)} up`}
                    onClick={() => move(block, -1)}
                    register={(el) => registerMoveBtn(moveBtnRef, `up:${block.id}`, el)}
                  />
                  <MoveButton
                    direction="down"
                    disabled={index === blocks.length - 1}
                    label={`Move ${labelFor(block)} down`}
                    onClick={() => move(block, 1)}
                    register={(el) =>
                      registerMoveBtn(moveBtnRef, `down:${block.id}`, el)
                    }
                  />
                  <button
                    type="button"
                    onClick={() => removeBlock(block)}
                    aria-label={`Remove ${labelFor(block)} block`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-card text-ink-muted transition-colors hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {block.type === "text" && (
                <TextBlockEditor
                  value={block.text}
                  onChange={(v) => setText(block.id, v)}
                />
              )}
            </li>
          ))}
        </ol>
      )}

      {/* Save */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          ref={saveRef}
          onClick={save}
          disabled={saving}
          className="inline-flex min-h-11 items-center rounded-card bg-brand-cyan px-4 py-2 text-sm font-semibold text-base transition-colors hover:bg-brand-cyan/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save layout"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-signal-danger">
          {error}
        </p>
      )}
      {region}
    </div>
  );
}

function registerMoveBtn(
  ref: { current: Map<string, HTMLButtonElement> },
  key: string,
  el: HTMLButtonElement | null,
) {
  if (el) ref.current.set(key, el);
  else ref.current.delete(key);
}

function MoveButton({
  direction,
  disabled,
  label,
  onClick,
  register,
}: {
  direction: "up" | "down";
  disabled: boolean;
  label: string;
  onClick: () => void;
  register: (el: HTMLButtonElement | null) => void;
}) {
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      ref={register}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-11 w-11 items-center justify-center rounded-card text-ink-muted transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

/** Focus an element after React has committed the next render (the picker panel
 * has unmounted by then), so keyboard focus is never dropped to the body. */
function focusAfterRender(el: HTMLButtonElement | null) {
  if (!el) return;
  requestAnimationFrame(() => el.focus());
}

function PickerTrigger({
  triggerRef,
  icon,
  label,
  panelId,
  open,
  disabled,
  disabledLabel,
  onToggle,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  icon: ReactNode;
  label: string;
  panelId: string;
  open: boolean;
  disabled: boolean;
  disabledLabel: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      ref={triggerRef}
      onClick={onToggle}
      disabled={disabled}
      aria-haspopup="true"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-label={disabled ? disabledLabel : `Add ${label} block`}
      title={disabled ? disabledLabel : undefined}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * An inline disclosure panel listing the entities available to add. Opens with
 * focus on the first item; Escape closes and returns focus to the trigger. It is
 * a fieldset/legend (a labeled group of add buttons), not an ARIA menu widget, so
 * each option is a plain, individually reachable button.
 */
function PickerPanel({
  id,
  legend,
  items,
  onPick,
  onClose,
}: {
  id: string;
  legend: string;
  items: { key: string; label: string }[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  return (
    <fieldset
      id={id}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="rounded-card border border-line bg-base/40 p-3"
    >
      <legend className="px-1 text-sm font-semibold text-ink">{legend}</legend>
      <ul role="list" className="mt-2 flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={item.key}>
            <button
              type="button"
              ref={index === 0 ? firstRef : undefined}
              onClick={() => onPick(item.key)}
              className="flex min-h-11 w-full items-center gap-2 rounded-card px-3 py-2 text-left text-sm text-ink hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function LayoutRadio({
  value,
  checked,
  onChange,
}: {
  value: ProfileLayout;
  checked: boolean;
  onChange: () => void;
}) {
  const label =
    value === "sidebar" ? "Layout B (sidebar)" : "Layout A (single column)";
  return (
    <label
      className={`flex flex-1 cursor-pointer items-center gap-2 rounded-card border px-3 py-2.5 text-sm font-medium transition-colors ${
        checked
          ? "border-brand-cyan bg-brand-cyan/10 text-ink"
          : "border-line bg-surface text-ink-muted hover:border-line-accent"
      }`}
    >
      <input
        type="radio"
        name="signal-layout"
        value={value}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
      {label}
    </label>
  );
}

function TextBlockEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  const id = useId();
  const remaining = TEXT_BLOCK_MAX - value.length;
  return (
    <div className="mt-3">
      <label htmlFor={id} className="sr-only">
        Text block content
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={TEXT_BLOCK_MAX}
        aria-describedby={`${id}-count`}
        placeholder="Write a short note for your profile."
        className="w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
      <p id={`${id}-count`} className="mt-1 text-xs text-ink-muted">
        {remaining} characters left
      </p>
    </div>
  );
}
