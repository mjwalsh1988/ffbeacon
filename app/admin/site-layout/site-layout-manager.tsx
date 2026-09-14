"use client";

/**
 * The Site Layout control panel.
 *
 * Four lists: the main menu's sections, its Tools submenu (which the footer
 * follows), the all tools page, and the homepage cards. Each homepage card also
 * carries a width, a tag and a highlight.
 *
 * Built for a keyboard and a screen reader first, because the person who uses
 * it most does so by ear:
 *   - every list is an ordered list with Up and Down buttons, no drag and drop;
 *   - a move is announced with the new position ("moved to position 2 of 6");
 *   - focus stays on the button that was pressed as its row moves, and the end
 *     buttons are aria-disabled rather than disabled, so focus is never dropped
 *     on the floor when a row reaches the top or the bottom;
 *   - each homepage card is a fieldset named by its position and tool, so its
 *     width, tag and highlight controls are announced with that context;
 *   - the grid preview is real text ("Row 2: FAAB Calculator, two columns, then
 *     1 empty column"), not a picture of boxes.
 *
 * Nothing is saved until Save layout is pressed, so an admin can try an order
 * out in the preview without the site changing under readers.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, RotateCcw, Undo2 } from "lucide-react";
import { AdminSwitch, useAdminAnnouncer } from "@/components/admin/admin-controls";
import { CARD_ACCENT_CLASSES, ToolBadgePill } from "@/components/tool-badge";
import {
  CARD_WIDTHS,
  CARD_WIDTH_LABELS,
  DEFAULT_SITE_LAYOUT,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_LABELS,
  NAV_SECTION_LABELS,
  TONE_TO_HIGHLIGHT,
  TOOL_BADGES,
  TOOL_BADGE_KEYS,
  TOOL_TITLES,
  type CardWidth,
  type HighlightColor,
  type HomepageToolCard,
  type NavSectionId,
  type SiteLayoutSettings,
  type ToolBadgeKey,
} from "@/lib/site-layout/default-settings";
import { applyOrder, moveEntry, packRows } from "@/lib/site-layout/order";
import type { ToolHref } from "@/lib/tools-catalog";
import { saveSiteLayoutAction } from "./actions";

type Announce = (message: string) => void;
type Direction = "up" | "down";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

const selectCls = `mt-1 min-h-11 w-full rounded-card border border-line bg-base px-3 text-sm text-ink ${focusRing}`;

const buttonCls = `inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-line ${focusRing}`;

function domId(...parts: string[]): string {
  return parts
    .join("-")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/-+/g, "-");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Up and Down for one list, with the announcement and the focus handled.
 *
 * React moves a keyed row by moving its DOM node, and a browser drops focus
 * from an element that is moved (it happens on Down, where the focused row is
 * the one React moves). So after every move the pressed button is found by id
 * and focused again, which keeps a keyboard reader exactly where they were: on
 * the same button, of the same row, at its new position. A LAYOUT effect, so
 * focus is back before the browser reports the change to a screen reader;
 * after paint, the drop is announced and cuts the move message off.
 *
 * The buttons' names do not carry the position. The announcement is the one
 * thing spoken after a move, rather than a renamed button and then the message
 * saying the same number twice.
 */
function useReorder<T>(
  list: T[],
  onChange: (next: T[]) => void,
  nameOf: (item: T) => string,
  keyOf: (item: T) => string,
  idPrefix: string,
  announce: Announce,
) {
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const id = pendingFocus.current;
    pendingFocus.current = null;
    document.getElementById(id)?.focus();
  }, [list]);

  return (index: number, direction: Direction) => {
    const item = list[index];
    if (item === undefined) return;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= list.length) {
      announce(`${nameOf(item)} is already ${direction === "up" ? "first" : "last"}.`);
      return;
    }
    pendingFocus.current = domId(idPrefix, keyOf(item), direction);
    onChange(moveEntry(list, index, direction));
    announce(`${nameOf(item)} moved to position ${target + 1} of ${list.length}.`);
  };
}

function MoveButtons({
  idPrefix,
  itemKey,
  name,
  index,
  count,
  onMove,
}: {
  idPrefix: string;
  itemKey: string;
  name: string;
  index: number;
  count: number;
  onMove: (index: number, direction: Direction) => void;
}) {
  return (
    <div className="flex shrink-0 gap-2">
      <button
        id={domId(idPrefix, itemKey, "up")}
        type="button"
        aria-disabled={index === 0 || undefined}
        aria-label={`Move ${name} up`}
        onClick={() => onMove(index, "up")}
        className={buttonCls}
      >
        <ArrowUp aria-hidden="true" className="h-4 w-4" />
        Up
      </button>
      <button
        id={domId(idPrefix, itemKey, "down")}
        type="button"
        aria-disabled={index === count - 1 || undefined}
        aria-label={`Move ${name} down`}
        onClick={() => onMove(index, "down")}
        className={buttonCls}
      >
        <ArrowDown aria-hidden="true" className="h-4 w-4" />
        Down
      </button>
    </div>
  );
}

/** A plain reorderable list of names. */
function OrderList<T extends string>({
  idPrefix,
  items,
  nameOf,
  onChange,
  announce,
}: {
  idPrefix: string;
  items: T[];
  nameOf: (item: T) => string;
  onChange: (next: T[]) => void;
  announce: Announce;
}) {
  const move = useReorder(items, onChange, nameOf, (item) => item, idPrefix, announce);
  return (
    <ol role="list" className="mt-4 grid gap-2">
      {items.map((item, i) => (
        <li
          key={item}
          className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface/60 px-4 py-2"
        >
          <span className="text-sm text-ink">
            <span className="font-mono text-ink-muted">{i + 1}.</span> {nameOf(item)}
          </span>
          <MoveButtons
            idPrefix={idPrefix}
            itemKey={item}
            name={nameOf(item)}
            index={i}
            count={items.length}
            onMove={move}
          />
        </li>
      ))}
    </ol>
  );
}

function Section({
  id,
  title,
  note,
  action,
  children,
}: {
  id: string;
  title: string;
  note: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-modal border border-line bg-surface/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {action}
      </div>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{note}</p>
      {children}
    </section>
  );
}

function CardRow({
  card,
  index,
  count,
  onMove,
  onUpdate,
  announce,
}: {
  card: HomepageToolCard;
  index: number;
  count: number;
  onMove: (index: number, direction: Direction) => void;
  onUpdate: (patch: Partial<HomepageToolCard>) => void;
  announce: Announce;
}) {
  const baseId = useId();
  const title = TOOL_TITLES[card.href];
  const tagHintId = `${baseId}-tag-hint`;

  function setHighlight(on: boolean) {
    if (!on) {
      onUpdate({ highlight: null });
      return;
    }
    // Start from the tag's own colour, so switching the highlight on beside a
    // green tag gives a green border. It stays a separate choice afterwards.
    const next: HighlightColor = card.badge
      ? TONE_TO_HIGHLIGHT[TOOL_BADGES[card.badge].tone]
      : "purple";
    onUpdate({ highlight: next });
    announce(`${title} border is highlighted ${HIGHLIGHT_LABELS[next]}. A color menu follows.`);
  }

  return (
    <li className={`rounded-card border p-4 shadow-lg ${CARD_ACCENT_CLASSES[card.highlight ?? "none"]}`}>
      <fieldset>
        <legend className="text-sm font-semibold text-ink">
          <span className="font-mono text-ink-muted">{index + 1}.</span> {title}
        </legend>

        <div className="mt-3">
          <MoveButtons
            idPrefix="home-card"
            itemKey={card.href}
            name={title}
            index={index}
            count={count}
            onMove={onMove}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={`${baseId}-width`} className="block text-xs font-medium text-ink-muted">
              Card width
            </label>
            <select
              id={`${baseId}-width`}
              value={card.width}
              onChange={(e) => onUpdate({ width: Number(e.target.value) as CardWidth })}
              className={selectCls}
            >
              {CARD_WIDTHS.map((width) => (
                <option key={width} value={width}>
                  {CARD_WIDTH_LABELS[width]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${baseId}-tag`} className="block text-xs font-medium text-ink-muted">
              Tag
            </label>
            <select
              id={`${baseId}-tag`}
              value={card.badge ?? ""}
              aria-describedby={tagHintId}
              onChange={(e) =>
                onUpdate({ badge: e.target.value ? (e.target.value as ToolBadgeKey) : null })
              }
              className={selectCls}
            >
              <option value="">No tag</option>
              {TOOL_BADGE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {TOOL_BADGES[key].label}
                </option>
              ))}
            </select>
            <p id={tagHintId} className="mt-1 text-xs leading-relaxed text-ink-muted">
              {card.badge
                ? TOOL_BADGES[card.badge].use
                : "With no tag, the card shows its position number in that corner."}
            </p>
          </div>

          <div>
            <div className="flex min-h-11 items-center gap-2">
              <AdminSwitch
                checked={card.highlight !== null}
                label={`Highlight border for ${title}`}
                onChange={setHighlight}
              />
              <span className="text-sm text-ink">Highlight border</span>
            </div>
            {card.highlight && (
              <div className="mt-2">
                <label
                  htmlFor={`${baseId}-highlight`}
                  className="block text-xs font-medium text-ink-muted"
                >
                  Highlight color
                </label>
                <select
                  id={`${baseId}-highlight`}
                  value={card.highlight}
                  onChange={(e) => onUpdate({ highlight: e.target.value as HighlightColor })}
                  className={selectCls}
                >
                  {HIGHLIGHT_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {HIGHLIGHT_LABELS[color]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {card.badge && (
          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            Tag preview: <ToolBadgePill badge={card.badge} />
          </p>
        )}
      </fieldset>
    </li>
  );
}

/** "2 columns, New features tag, green border", for one preview box. */
function describeCardExtras(card: HomepageToolCard, span: number): string {
  const parts = [plural(span, "column")];
  if (card.badge) parts.push(`${TOOL_BADGES[card.badge].label} tag`);
  if (card.highlight) parts.push(`${HIGHLIGHT_LABELS[card.highlight].toLowerCase()} border`);
  return parts.join(", ");
}

/**
 * How the homepage grid will fill at one width. Rows come from `packRows`,
 * which models the grid's own non-dense placement, and each row is drawn as a
 * small grid with the same spans, so the picture and the words agree.
 */
function GridPreview({
  cards,
  columns,
  heading,
}: {
  cards: HomepageToolCard[];
  columns: number;
  heading: string;
}) {
  const rows = packRows(cards, (card) => card.width, columns);
  const gaps = rows.filter((row) => row.empty > 0 && row !== rows[rows.length - 1]).length;
  const summary =
    `${plural(rows.length, "row")}. ` +
    (gaps === 0
      ? "No gaps before the last row."
      : `${plural(gaps, "row")} before the last ${gaps === 1 ? "ends" : "end"} with empty space, because the next card was too wide to fit.`);

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{heading}</h3>
      <p className="mt-1 text-xs text-ink-muted">{summary}</p>
      <ol role="list" className="mt-3 space-y-2">
        {rows.map((row, r) => (
          <li key={r}>
            <span className="sr-only">Row {r + 1}: </span>
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {row.items.map((card) => {
                const span = Math.min(card.width, columns);
                return (
                  <div
                    key={card.href}
                    style={{ gridColumn: `span ${span}` }}
                    className={`rounded-card border px-3 py-2 text-xs text-ink ${CARD_ACCENT_CLASSES[card.highlight ?? "none"]}`}
                  >
                    <span className="block font-medium">{TOOL_TITLES[card.href]}</span>
                    {/* Visible words, not only a border colour, so the preview
                        says the same thing by eye and by ear. */}
                    <span className="block text-ink-muted">
                      <span className="sr-only">, </span>
                      {describeCardExtras(card, span)}
                    </span>
                  </div>
                );
              })}
              {row.empty > 0 && (
                <div
                  style={{ gridColumn: `span ${row.empty}` }}
                  className="rounded-card border border-dashed border-line px-3 py-2 text-xs text-ink-muted"
                >
                  <span className="sr-only">then </span>
                  {plural(row.empty, "empty column")}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SiteLayoutManager({
  initialSettings,
  initialUpdatedAt,
}: {
  initialSettings: SiteLayoutSettings;
  /** The row's version when the page loaded; the save is refused if it moved. */
  initialUpdatedAt: string | null;
}) {
  const [settings, setSettings] = useState<SiteLayoutSettings>(() => clone(initialSettings));
  const [saved, setSaved] = useState<SiteLayoutSettings>(() => clone(initialSettings));
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const { announce, region } = useAdminAnnouncer();

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  // Closing the tab with unsaved changes asks first. In-app navigation does not
  // fire this, which is the browser's rule rather than a choice made here.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // An in-app link (the admin menu, the rail) skips beforeunload, so a click on
  // one is caught here first and asks before unsaved changes are thrown away.
  // Capture phase on the document, so it runs before Next's own link handler;
  // Enter on a focused link fires the same click.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      // Leaving the site is a full navigation, which beforeunload already covers.
      if (url.origin !== window.location.origin) return;
      // A link to a spot on this same page loses nothing.
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      if (!window.confirm("You have unsaved layout changes. Leave this page without saving them?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  function patch(update: (current: SiteLayoutSettings) => SiteLayoutSettings) {
    setSettings((current) => update(current));
    setStatus(null);
  }

  const toolName = (href: ToolHref) => TOOL_TITLES[href];
  const cards = settings.homepage.cards;
  const moveCard = useReorder(
    cards,
    (next) => patch((s) => ({ ...s, homepage: { cards: next } })),
    (card) => TOOL_TITLES[card.href],
    (card) => card.href,
    "home-card",
    announce,
  );

  function updateCard(href: ToolHref, update: Partial<HomepageToolCard>) {
    patch((s) => ({
      ...s,
      homepage: {
        cards: s.homepage.cards.map((card) => (card.href === href ? { ...card, ...update } : card)),
      },
    }));
  }

  function save() {
    // The button stays focusable while a save runs (aria-disabled, not
    // disabled, so focus is not thrown to the page body), so a second press is
    // ignored here instead.
    if (saving) return;
    startSaving(async () => {
      const result = await saveSiteLayoutAction(settings, baseUpdatedAt);
      if (result.ok) {
        setSaved(clone(settings));
        setBaseUpdatedAt(result.updatedAt);
        const text = "Saved. Every page shows the new layout the next time it loads.";
        setStatus({ tone: "ok", text });
        announce(text);
      } else {
        setStatus({ tone: "bad", text: result.error });
        announce(`Not saved. ${result.error}`);
      }
    });
  }

  // Two of these on the page, so each carries a hidden ending naming its list;
  // a list of buttons would otherwise show two identical entries.
  const matchMenuButton = (forList: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={buttonCls}>
      Match the main menu order<span className="sr-only"> for {forList}</span>
    </button>
  );

  return (
    <div className="space-y-8">
      {region}

      <Section
        id="layout-menu-sections"
        title="Main menu sections"
        note="The top level of the menu: the side rail on a wide screen and the drawer on a phone. My Beacon and Admin only show for the readers they are for, and keep their place among the others."
      >
        <OrderList<NavSectionId>
          idPrefix="menu-section"
          items={settings.menu.sectionOrder}
          nameOf={(id) => NAV_SECTION_LABELS[id]}
          onChange={(next) => patch((s) => ({ ...s, menu: { ...s.menu, sectionOrder: next } }))}
          announce={announce}
        />
      </Section>

      <Section
        id="layout-menu-tools"
        title="Main menu tools"
        note="The Tools submenu in the side rail and the phone drawer. The Tools column in the footer follows this order too."
      >
        <OrderList<ToolHref>
          idPrefix="menu-tool"
          items={settings.menu.toolOrder}
          nameOf={toolName}
          onChange={(next) => patch((s) => ({ ...s, menu: { ...s.menu, toolOrder: next } }))}
          announce={announce}
        />
      </Section>

      <Section
        id="layout-tools-page"
        title="All tools page"
        note="The sections on the all tools page, top to bottom."
        action={matchMenuButton("the all tools page", () => {
          patch((s) => ({ ...s, toolsPage: { toolOrder: [...s.menu.toolOrder] } }));
          announce("The all tools page now matches the main menu order.");
        })}
      >
        <OrderList<ToolHref>
          idPrefix="tools-page"
          items={settings.toolsPage.toolOrder}
          nameOf={toolName}
          onChange={(next) => patch((s) => ({ ...s, toolsPage: { toolOrder: next } }))}
          announce={announce}
        />
      </Section>

      <Section
        id="layout-homepage"
        title="Homepage tool cards"
        note="The cards in the homepage Tools section, in reading order. The tag is the pill in the card's top corner. The highlight is the colored border and corner glow, and it is set separately from the tag. On a phone every card is full width whatever its width here."
        action={matchMenuButton("the homepage cards", () => {
          patch((s) => ({
            ...s,
            homepage: { cards: applyOrder(s.homepage.cards, s.menu.toolOrder, (c) => c.href) },
          }));
          announce("The homepage cards now match the main menu order. Widths, tags and highlights are unchanged.");
        })}
      >
        <ol role="list" className="mt-4 grid gap-3">
          {cards.map((card, i) => (
            <CardRow
              key={card.href}
              card={card}
              index={i}
              count={cards.length}
              onMove={moveCard}
              onUpdate={(update) => updateCard(card.href, update)}
              announce={announce}
            />
          ))}
        </ol>

        <div className="mt-6 grid gap-6 rounded-card border border-line bg-base/60 p-4 lg:grid-cols-2">
          <GridPreview cards={cards} columns={3} heading="Preview on a wide screen, three columns" />
          <GridPreview cards={cards} columns={2} heading="Preview on a tablet, two columns" />
        </div>
      </Section>

      <section aria-labelledby="layout-save" className="rounded-modal border border-line bg-surface/40 p-5">
        <h2 id="layout-save" className="text-lg font-semibold text-ink">
          Save layout
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {dirty ? "You have unsaved changes." : "Everything on this page is saved."}
        </p>
        {status && (
          <p
            className={`mt-3 rounded-card border px-3 py-2 text-sm ${
              status.tone === "ok"
                ? "border-signal-success/40 bg-signal-success/10 text-signal-success"
                : "border-signal-danger/40 bg-signal-danger/10 text-signal-danger"
            }`}
          >
            {status.text}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={save}
            aria-disabled={saving || undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 aria-disabled:opacity-60 ${focusRing}`}
          >
            <Check aria-hidden="true" className="h-4 w-4" />
            {saving ? "Saving..." : "Save layout"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSettings(clone(saved));
              setStatus(null);
              announce("Unsaved changes undone. The page shows the saved layout again.");
            }}
            className={buttonCls}
          >
            <Undo2 aria-hidden="true" className="h-4 w-4" />
            Undo unsaved changes
          </button>
          <button
            type="button"
            onClick={() => {
              setSettings(clone(DEFAULT_SITE_LAYOUT));
              setStatus(null);
              announce("The shipped layout is loaded. Press Save layout to apply it.");
            }}
            className={buttonCls}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Load the shipped layout
          </button>
        </div>
      </section>
    </div>
  );
}
