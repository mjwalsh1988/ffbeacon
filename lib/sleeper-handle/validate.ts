/**
 * The one gate a handle passes through before it is saved.
 *
 * Pure and client-safe on purpose: the save form runs it before it submits,
 * and the server action runs it again before it calls Sleeper, so the two
 * can never disagree about what a handle is. The grammar itself is
 * `HANDLE_PATTERN` from `lib/manager-pulse/handle.ts`, which is already the
 * one copy and already client-safe (it imports nothing).
 *
 * This module exists rather than importing that one everywhere so nothing
 * outside Manager Pulse grows a reason to import `lib/manager-pulse/*`.
 *
 * Debt, recorded and not fixed here: `app/tools/faab/actions.ts` and
 * `app/tools/beacon-breakdown/actions.ts` each carry a looser
 * `USERNAME_PATTERN` (dot and hyphen, 64 characters) and
 * `lib/on-the-clock/validation.ts` a stricter one. Making this the one gate
 * for all of them is a follow-up.
 */

import { HANDLE_PATTERN } from "@/lib/manager-pulse/handle";

/**
 * Trim, lowercase, and test against Sleeper's grammar. Null when invalid.
 *
 * Normalizing before the test is deliberate here and is the opposite of what
 * `isValidSleeperHandle` does: that one gates a value that is about to be
 * fetched, so it has to reject what it was actually given. This one gates a
 * value a person just typed, where a capital letter or a trailing space is a
 * typo rather than an attack, and Sleeper resolves handles case-insensitively.
 */
export function normalizeSleeperHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  return HANDLE_PATTERN.test(normalized) ? normalized : null;
}

/** The one sentence every surface says when a handle fails the grammar. */
export const INVALID_HANDLE_MESSAGE =
  "That doesn't look like a Sleeper handle. Use letters, numbers, and underscores only, up to 32 characters.";
