/**
 * The two-pass split is the thing under test.
 *
 * Pass one is an indexed equality on `external_ids->>'sleeper'`. Pass two is
 * the `sleeper_slug_tail` fallback for whatever pass one could not resolve. The
 * assertion that matters most is the negative one: on a normal corpus, where
 * every player row carries its external id, the second query must not run at
 * all. Merging the two into one `.or()` is what made this read a full table
 * scan (site-speed-audit-and-plan.md, 4.1), and a test that only checked the
 * returned names would have passed happily throughout.
 */

import { describe, expect, it, vi } from "vitest";
import { resolveSleeperPlayers } from "@/lib/sleeper-player-lookup";

type Row = {
  id: string;
  slug: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string;
  team: string | null;
  external_ids: Record<string, unknown>;
  birth_date: string | null;
  years_experience: number | null;
};

function row(partial: Partial<Row> & { id: string; slug: string }): Row {
  return {
    full_name: null,
    first_name: null,
    last_name: null,
    position: "RB",
    team: "BUF",
    external_ids: {},
    birth_date: null,
    years_experience: null,
    ...partial,
  };
}

/**
 * A Supabase double that records which pass each query was.
 *
 * `.or()` terminates pass one, `.in()` terminates pass two, so the calls list
 * is the evidence for the skip assertion.
 */
function client(opts: {
  indexed?: Row[];
  indexedError?: { message: string };
  fallback?: Row[];
  fallbackError?: { message: string };
}) {
  const calls: { pass: "indexed" | "fallback"; arg: unknown }[] = [];
  const from = vi.fn(() => ({
    select: () => ({
      or: (arg: string) => {
        calls.push({ pass: "indexed", arg });
        return Promise.resolve({
          data: opts.indexed ?? [],
          error: opts.indexedError ?? null,
        });
      },
      in: (_column: string, arg: string[]) => {
        calls.push({ pass: "fallback", arg });
        return Promise.resolve({
          data: opts.fallback ?? [],
          error: opts.fallbackError ?? null,
        });
      },
    }),
  }));
  return { supabase: { from } as never, calls };
}

describe("resolveSleeperPlayers", () => {
  it("skips the second pass when the indexed pass resolved every id", async () => {
    const { supabase, calls } = client({
      indexed: [
        row({
          id: "p1",
          slug: "josh-allen-4984",
          full_name: "Josh Allen",
          external_ids: { sleeper: "4984" },
        }),
        row({
          id: "p2",
          slug: "james-cook-8138",
          full_name: "James Cook",
          external_ids: { sleeper: "8138" },
        }),
      ],
    });

    const out = await resolveSleeperPlayers(supabase, ["4984", "8138"]);

    expect(Object.keys(out).sort()).toEqual(["4984", "8138"]);
    expect(out["4984"].name).toBe("Josh Allen");
    expect(calls.map((c) => c.pass)).toEqual(["indexed"]);
  });

  it("runs the fallback only for the ids the indexed pass missed", async () => {
    const { supabase, calls } = client({
      indexed: [
        row({
          id: "p1",
          slug: "josh-allen-4984",
          full_name: "Josh Allen",
          external_ids: { sleeper: "4984" },
        }),
      ],
      fallback: [
        row({ id: "p9", slug: "rookie-name-9999", full_name: "Rookie Name" }),
      ],
    });

    const out = await resolveSleeperPlayers(supabase, ["4984", "9999"]);

    expect(calls.map((c) => c.pass)).toEqual(["indexed", "fallback"]);
    // The fallback is asked for the missing id and nothing else.
    expect(calls[1].arg).toEqual(["9999"]);
    expect(out["9999"].name).toBe("Rookie Name");
    expect(out["9999"].id).toBe("p9");
  });

  it("drops an id that is not a plain number before it reaches a query", async () => {
    const { supabase, calls } = client({});

    const out = await resolveSleeperPlayers(supabase, [
      "not-an-id",
      "4984); drop table players;--",
    ]);

    expect(out).toEqual({});
    expect(calls).toEqual([]);
  });

  it("carries the columns the league overview needs", async () => {
    const { supabase } = client({
      indexed: [
        row({
          id: "p1",
          slug: "james-cook-8138",
          first_name: "James",
          last_name: "Cook",
          position: "RB",
          team: "BUF",
          birth_date: "1999-09-25",
          years_experience: 3,
          external_ids: { sleeper: "8138" },
        }),
      ],
    });

    const out = await resolveSleeperPlayers(supabase, ["8138"]);

    expect(out["8138"]).toMatchObject({
      id: "p1",
      slug: "james-cook-8138",
      name: "James Cook",
      position: "RB",
      team: "BUF",
      birthDate: "1999-09-25",
      yearsExperience: 3,
    });
  });

  it("tolerates a failed read by default and throws when asked to", async () => {
    const failing = () => client({ indexedError: { message: "boom" } });

    await expect(
      resolveSleeperPlayers(failing().supabase, ["4984"]),
    ).resolves.toEqual({});

    await expect(
      resolveSleeperPlayers(failing().supabase, ["4984"], {
        throwOnError: true,
      }),
    ).rejects.toThrow("player resolve failed: boom");
  });
});
