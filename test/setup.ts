import { beforeEach } from "vitest";
import { bustMemo } from "@/lib/memo-ttl";

/**
 * Clear the cross-request memo before every test.
 *
 * `lib/memo-ttl.ts` holds one Map for the life of the process, which is the
 * whole point of it in production and a trap in a test file. A suite that mocks
 * a settings backend differently per case (the projection source resolver, the
 * Signal Scout round engine, several settings loaders) writes its first case's
 * answer into that Map, and every later case in the same file is served that
 * answer instead of its own mock. The symptom is a test failing on a value
 * belonging to a different test, which is a long afternoon to diagnose from the
 * assertion alone.
 *
 * Clearing it globally rather than per file means a new memoised read cannot
 * quietly reintroduce the problem. The tests that assert the memo's own
 * behaviour make their calls inside a single test, so this hook does not
 * interfere with them.
 */
beforeEach(() => {
  bustMemo("");
});
