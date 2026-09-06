/**
 * Sleeper's handle grammar, and the gate that tests against it.
 *
 * This lives apart from `discover.ts` for one reason: it is the only thing in
 * that file the search form, a CLIENT component, ever wanted. `discover.ts`
 * imports `lib/sleeper.ts`, which since the Sleeper call budget landed
 * (`lib/sleeper-budget.ts`, MPS-T032) imports `node:async_hooks`, which
 * webpack cannot put in a browser bundle. A pure module with no imports at all
 * can be read from either side, and `discover.ts` re-exports both names so
 * there is still exactly ONE copy of the grammar.
 *
 * `lib/client-sleeper-import.test.ts` is what keeps this arrangement honest.
 */

/** Sleeper's own handle grammar: lowercase alphanumeric plus underscore, 1-32 chars. */
export const HANDLE_PATTERN = /^[a-z0-9_]{1,32}$/;

/**
 * True when `raw` already matches Sleeper's handle grammar exactly, with no
 * normalization performed here. Uppercase, spaces, path separators, and an
 * empty or over-length string are all rejected, on purpose: this is the gate
 * that runs before any fetch, so it has to reject what it is actually given,
 * not a cleaned-up version of it.
 */
export function isValidSleeperHandle(raw: string): boolean {
  return typeof raw === "string" && HANDLE_PATTERN.test(raw);
}
