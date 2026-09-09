"use client";

/**
 * The menu behind a bookmark on the desktop bar: move it along, rename it,
 * remove it.
 *
 * IT OPENS THREE WAYS, ON PURPOSE. A right-click on the row opens it where the
 * pointer is, which is what a bookmark bar has always done. The Context Menu
 * key and Shift+F10 open it anchored to the row, because Windows sends a real
 * `contextmenu` event for both and a menu that appeared in the corner of the
 * screen would be worse than none. A small button beside the bookmark opens the
 * same menu anchored under itself, which is the half every other platform and
 * every pointer-free reader can reach.
 *
 * THE BUTTON IS VISIBLE WITHOUT HOVER ON A TOUCH DEVICE. It fades in on hover
 * on a mouse, and `@media (hover: none)` in app/globals.css pins it on
 * otherwise. A touchscreen laptop, and any tablet whose user agent reads as a
 * desktop (iPadOS Safari says Macintosh by default, so this is the common case,
 * not the exotic one), has no hover, and a long press producing a `contextmenu`
 * event is not something to rest reorder, rename and remove on.
 *
 * WAI-ARIA menu behaviour, all of it: `role="menu"` over `role="menuitem"`
 * buttons, roving focus with the arrow keys plus Home and End, Escape closes
 * and hands focus back to whatever opened it, a click anywhere outside closes
 * it, and Tab closes it rather than walking the reader through a floating list
 * into the page behind.
 *
 * FOCUS COMES BACK ON EVERY EXIT, choosing an item included. Returning it only
 * on Escape meant Move left dropped the reader at the top of the document, and
 * that Rename and Remove handed their dialog `document.body` as the element to
 * restore to when it closed, so the reader ended up there too.
 *
 * DISABLED ITEMS STAY IN THE ROVING ORDER. They carry `aria-disabled` rather
 * than `disabled`, and the arrow keys visit them, because a reader on the first
 * bookmark should hear that Move left exists and is unavailable rather than
 * never hear of it.
 *
 * Move is worded as LEFT and RIGHT here because that is what the bar does. The
 * action underneath is direction-neutral ("earlier"/"later"), so the sheet can
 * call the very same one UP and DOWN without a second code path.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  MoreVertical,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";

export type BookmarkMenuAction = "earlier" | "later" | "rename" | "delete";

type MenuItem = {
  action: BookmarkMenuAction;
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  danger?: boolean;
};

/** Where a menu was opened from, in viewport coordinates. */
type Anchor = { x: number; y: number };

export function BookmarkRowMenu({
  bookmarkLabel,
  canMoveEarlier,
  canMoveLater,
  busy,
  onAction,
}: {
  bookmarkLabel: string;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  busy: boolean;
  onAction: (action: BookmarkMenuAction) => void;
}) {
  const menuId = useId();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const open = useCallback((next: Anchor) => setAnchor(next), []);

  /**
   * Close, and put focus back on the trigger FIRST.
   *
   * The order matters when an item was chosen: Rename and Remove both open a
   * dialog, and the dialog reads `document.activeElement` on mount to know
   * where to return the reader afterwards. Moving focus before React commits
   * the unmount means the dialog captures this button rather than `body`.
   */
  const close = useCallback(() => {
    triggerRef.current?.focus();
    setAnchor(null);
  }, []);

  const items: MenuItem[] = [
    {
      action: "earlier",
      label: "Move left",
      icon: ArrowLeft,
      disabled: !canMoveEarlier || busy,
    },
    {
      action: "later",
      label: "Move right",
      icon: ArrowRight,
      disabled: !canMoveLater || busy,
    },
    { action: "rename", label: "Rename", icon: Pencil, disabled: busy },
    {
      action: "delete",
      label: "Remove",
      icon: Trash2,
      disabled: busy,
      danger: true,
    },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-controls={anchor !== null ? menuId : undefined}
        aria-label={`Options for the ${bookmarkLabel} bookmark`}
        // `aria-disabled`, never `disabled`. Disabling a button that currently
        // holds focus makes the browser drop focus to `body`, and this one is
        // handed focus back by `close()` at the exact moment a write starts.
        aria-disabled={busy || undefined}
        onClick={(event) => {
          if (busy) return;
          const box = event.currentTarget.getBoundingClientRect();
          open({ x: box.right, y: box.bottom + 4 });
        }}
        // `focus:opacity-100`, not `focus-visible:`. Closing the menu hands
        // focus back here PROGRAMMATICALLY, and a programmatic focus does not
        // always satisfy :focus-visible, so a reader who pressed Escape would
        // be standing on a button they cannot see.
        className="bookmark-row-menu-trigger inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-subtle opacity-0 transition-opacity hover:text-ink focus:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-cyan group-hover:opacity-100 aria-disabled:opacity-40"
      >
        <MoreVertical aria-hidden="true" className="h-3.5 w-3.5" />
      </button>

      {/* The right-click half. Rendered as a sibling listener rather than a
          wrapper so the bookmark link keeps its own simple markup. */}
      <ContextMenuTarget onOpen={open} disabled={busy} />

      {anchor && (
        <MenuSurface
          id={menuId}
          anchor={anchor}
          triggerRef={triggerRef}
          bookmarkLabel={bookmarkLabel}
          items={items}
          onClose={close}
          onAction={(action) => {
            close();
            onAction(action);
          }}
        />
      )}
    </>
  );
}

/**
 * Attaches the right-click handler to the menu's parent element, which is the
 * bookmark row. Renders nothing.
 *
 * The listener lives on the parent rather than on the link so that a right
 * click anywhere on the row, including the icon and the gap around the label,
 * opens the menu.
 *
 * A keyboard-raised context menu (the Context Menu key, Shift+F10) fires the
 * same event with no coordinates, so it is anchored to the row instead of being
 * clamped into the top-left corner of the viewport.
 */
function ContextMenuTarget({
  onOpen,
  disabled,
}: {
  onOpen: (anchor: Anchor) => void;
  disabled: boolean;
}) {
  const markerRef = useRef<HTMLSpanElement>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    const row = markerRef.current?.parentElement;
    if (!row) return;
    const handler = (event: MouseEvent) => {
      if (disabledRef.current) return;
      event.preventDefault();
      if (event.clientX === 0 && event.clientY === 0) {
        const box = row.getBoundingClientRect();
        onOpen({ x: box.left + 8, y: box.bottom + 4 });
        return;
      }
      onOpen({ x: event.clientX, y: event.clientY });
    };
    row.addEventListener("contextmenu", handler);
    return () => row.removeEventListener("contextmenu", handler);
  }, [onOpen]);

  return <span ref={markerRef} hidden />;
}

function MenuSurface({
  id,
  anchor,
  triggerRef,
  bookmarkLabel,
  items,
  onClose,
  onAction,
}: {
  id: string;
  anchor: Anchor;
  /** The button the menu belongs to, so it can follow it when the page moves. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  bookmarkLabel: string;
  items: MenuItem[];
  onClose: () => void;
  onAction: (action: BookmarkMenuAction) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: anchor.x,
    top: anchor.y,
  });
  /** Where the menu sits relative to its trigger, fixed at open time. */
  const offset = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => setMounted(true), []);

  /** Clamp a viewport point so the whole menu stays on screen. */
  const place = useCallback((point: Anchor) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const box = surface.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(point.x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(point.y, window.innerHeight - box.height - 8)),
    });
  }, []);

  // Move focus to the first item, and put the menu where it belongs. Measured
  // after mount, because the width and height are not known until it paints.
  useEffect(() => {
    if (!mounted) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const triggerBox = triggerRef.current?.getBoundingClientRect();
    if (triggerBox) {
      offset.current = {
        x: anchor.x - triggerBox.left,
        y: anchor.y - triggerBox.top,
      };
    }
    place(anchor);
    surface.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [mounted, anchor, place, triggerRef]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        // A floating menu is not part of the page's tab order. Tab dismisses it
        // and lets the press land where it would have without the menu open.
        onClose();
        return;
      }
      const surface = surfaceRef.current;
      if (!surface) return;
      // Every item, the unavailable ones included. See the file header.
      const focusable = Array.from(
        surface.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      );
      if (focusable.length === 0) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusable[(index + 1) % focusable.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusable[(index - 1 + focusable.length) % focusable.length]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        focusable[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!surfaceRef.current?.contains(event.target as Node)) onClose();
    };
    /**
     * A scroll used to close the menu. It cannot: VoiceOver scrolls the
     * viewport as its cursor moves from one item to the next, and a
     * capture-phase listener catches that, so the menu shut itself on the first
     * swipe. It follows its trigger instead, which is what a reader wanted from
     * a fixed-position menu in the first place.
     */
    const onViewportChange = () => {
      const triggerBox = triggerRef.current?.getBoundingClientRect();
      if (!triggerBox || !offset.current) return;
      place({
        x: triggerBox.left + offset.current.x,
        y: triggerBox.top + offset.current.y,
      });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [mounted, onClose, place, triggerRef]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={surfaceRef}
      id={id}
      role="menu"
      // The name goes on the container itself. It used to be an sr-only span
      // inside, which made the menu own a child that is not a menu item.
      aria-label={`Options for the ${bookmarkLabel} bookmark`}
      style={{ left: position.left, top: position.top }}
      className="fixed z-[60] min-w-[11rem] rounded-card border border-line bg-surface-elevated p-1 shadow-2xl shadow-black/60"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            onClick={() => {
              if (item.disabled) return;
              onAction(item.action);
            }}
            className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-cyan ${
              item.disabled
                ? "cursor-not-allowed text-ink-subtle"
                : item.danger
                  ? // The wash lifts the background enough that #EF4444 on it
                    // falls under 4.5:1, so the text lightens with it.
                    "text-signal-danger hover:bg-signal-danger/10 hover:text-rose-300"
                  : "text-ink hover:bg-base/70"
            }`}
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
