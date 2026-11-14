import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sleeper", () => ({ getSleeperDraftPicksOrNull: vi.fn() }));
vi.mock("@/lib/draft-selections", () => ({
  recordDraftSelections: vi.fn(),
  draftIdsWithSelections: vi.fn(async () => new Set<string>()),
}));
vi.mock("@/lib/on-the-clock/format-detect", () => ({
  ffbeaconFormatCandidates: vi.fn(async () => []),
  detectLeagueFormat: vi.fn(() => null),
}));
vi.mock("@/lib/on-the-clock/draft-derive", () => ({ inferPlayerPool: vi.fn(() => null) }));

import { getSleeperDraftPicksOrNull } from "@/lib/sleeper";
import { recordDraftSelections } from "@/lib/draft-selections";
import { captureLeagueDraftSelections, MAX_DRAFTS_CAPTURED_PER_RUN } from "./league-draft-selections";

function draftRow(id: string) {
  return {
    sleeper_draft_id: id,
    season: 2025,
    status: "complete",
    type: "snake",
    settings: { rounds: 4, teams: 12 },
    start_time: null,
    picks_captured_at: null,
    pick_capture_attempts: 0,
  };
}

/** leagues and league_drafts reads, plus every league_drafts update it saw. */
function fakeClient(drafts: ReturnType<typeof draftRow>[], opts: { draftsError?: string } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const draftsChain: Record<string, unknown> = {};
  for (const key of ["select", "eq", "is", "lt"]) draftsChain[key] = () => draftsChain;
  draftsChain.order = async () => ({
    data: opts.draftsError ? null : drafts,
    error: opts.draftsError ? { message: opts.draftsError } : null,
  });
  const client = {
    from(table: string) {
      if (table === "leagues") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "row", sleeper_league_id: "L1", scoring_settings: {}, roster_positions: [], metadata: {} },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        ...draftsChain,
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { client: client as never, updates };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("captureLeagueDraftSelections", () => {
  it("counts a draft written with zero rows as an attempt, so it is not refetched forever", async () => {
    vi.mocked(getSleeperDraftPicksOrNull).mockResolvedValue([{ pick_no: 1 }] as never);
    vi.mocked(recordDraftSelections).mockResolvedValue({ ok: true, rowsWritten: 0 } as never);
    const { client, updates } = fakeClient([draftRow("d1")]);

    await captureLeagueDraftSelections(client, "row");

    expect(updates).toEqual([{ pick_capture_attempts: 1 }]);
  });

  it("caps a normal run and lifts the cap when asked", async () => {
    vi.mocked(getSleeperDraftPicksOrNull).mockResolvedValue([]);
    const drafts = Array.from({ length: MAX_DRAFTS_CAPTURED_PER_RUN + 3 }, (_, i) => draftRow(`d${i}`));

    await captureLeagueDraftSelections(fakeClient(drafts).client, "row");
    expect(getSleeperDraftPicksOrNull).toHaveBeenCalledTimes(MAX_DRAFTS_CAPTURED_PER_RUN);

    vi.mocked(getSleeperDraftPicksOrNull).mockClear();
    await captureLeagueDraftSelections(fakeClient(drafts).client, "row", {
      maxDrafts: Number.POSITIVE_INFINITY,
    });
    expect(getSleeperDraftPicksOrNull).toHaveBeenCalledTimes(drafts.length);
  });

  it("reports a failed read as a failure, never as nothing to capture", async () => {
    const result = await captureLeagueDraftSelections(
      fakeClient([], { draftsError: "timeout" }).client,
      "row",
    );
    expect(result.fetchFailures).toBe(1);
  });
});
