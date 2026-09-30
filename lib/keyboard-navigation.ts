/**
 * Arrow-key arithmetic shared by the site's comboboxes and radio groups. Pure,
 * so the rules are tested once rather than re-derived in every component.
 */

/**
 * No option is active. A combobox result list starts here and returns here
 * whenever its results change: the reader has typed, not chosen, and the
 * first Down arrow is what lands on the first result. Starting at 0 instead
 * made that first Down land on the SECOND result, so the top match could only
 * be reached by pressing Up.
 */
export const NO_ACTIVE_OPTION = -1;

/**
 * Next active option in a combobox listbox for one arrow key. Down from
 * nothing lands on the first option, Up from nothing on the last; both stop
 * at the ends rather than wrapping, so holding a key never loops a reader
 * back past where they started. An empty list has no active option.
 */
export function nextComboboxIndex(
  current: number,
  key: "ArrowDown" | "ArrowUp",
  count: number,
): number {
  if (count <= 0) return NO_ACTIVE_OPTION;
  if (current < 0 || current >= count) {
    return key === "ArrowDown" ? 0 : count - 1;
  }
  return key === "ArrowDown" ? Math.min(count - 1, current + 1) : Math.max(0, current - 1);
}

/**
 * Next checked radio in a group for one key, per the WAI-ARIA radio group
 * pattern: Right and Down move forward, Left and Up move back, both wrap, and
 * Home and End jump to the ends. Returns null for any other key so the caller
 * leaves it alone (Tab, Space, letters).
 */
export function nextRadioIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const from = current < 0 ? 0 : current;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (from + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
