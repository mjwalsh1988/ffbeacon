"use client";

import { useRef, type KeyboardEvent } from "react";
import { nextRadioIndex } from "@/lib/keyboard-navigation";

/**
 * Keyboard behaviour for a group of role="radio" buttons, per the WAI-ARIA
 * radio group pattern: the group is ONE Tab stop (the checked option, or the
 * first available one when nothing is checked), and the arrow keys move focus
 * and selection together, wrapping, skipping any option that cannot be picked.
 *
 * Unavailable options are marked aria-disabled by the caller rather than
 * disabled, and so is the whole group while a selection is being applied.
 * A disabled button drops focus to the page body the moment it is disabled,
 * which is exactly what used to happen to a keyboard reader who had just made
 * a choice.
 */
export function useRadioGroup({
  count,
  checkedIndex,
  onSelect,
  isUnavailable,
}: {
  count: number;
  /** -1 when nothing is checked. */
  checkedIndex: number;
  onSelect: (index: number) => void;
  isUnavailable?: (index: number) => boolean;
}) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const unavailable = (i: number) => isUnavailable?.(i) ?? false;

  let tabStop = checkedIndex >= 0 && !unavailable(checkedIndex) ? checkedIndex : -1;
  if (tabStop < 0) {
    for (let i = 0; i < count; i += 1) {
      if (!unavailable(i)) {
        tabStop = i;
        break;
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    let next = nextRadioIndex(index, event.key, count);
    if (next === null) return;
    event.preventDefault();
    // Home and End land on an end and then walk inward past anything that
    // cannot be picked; the arrows keep walking in their own direction.
    const step =
      event.key === "Home"
        ? "ArrowRight"
        : event.key === "End"
          ? "ArrowLeft"
          : event.key;
    let guard = 0;
    while (unavailable(next) && guard < count) {
      next = nextRadioIndex(next, step, count) ?? next;
      guard += 1;
    }
    if (unavailable(next)) return;
    refs.current[next]?.focus();
    if (next !== checkedIndex) onSelect(next);
  };

  return {
    /** Callback ref for option `index`. */
    refFor: (index: number) => (el: HTMLElement | null) => {
      refs.current[index] = el;
    },
    tabIndexFor: (index: number) => (index === tabStop ? 0 : -1),
    onKeyDown,
  };
}
