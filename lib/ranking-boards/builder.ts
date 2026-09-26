/**
 * Beacon Ranker's comparison engine (plan sections 5.2 to 5.4, 7 and 8).
 *
 * PURE AND CLIENT-SAFE. A run is an ANSWER LOG, not a state snapshot: the run
 * row stores the setup and an append-only list of small answers, and every
 * view of the run (the board so far, who is climbing, what the next question
 * is, the tier pass) is `foldRun(setup, answers)`. The server folds before
 * accepting every answer, so an answer is checked against the state the SERVER
 * derived (is that really the pair on screen, is that rank really above his
 * current spot, is the guest still under the cap) and client state is never
 * trusted. The page folds the same log to draw it. Undo pops the last answer.
 * Resume replays.
 *
 * THE ALGORITHM IS INSERTION SORT, which suits a list seeded from real
 * rankings: a reader who mostly agrees answers about one question per player.
 *
 *   A newcomer enters below the board and is asked about against the player at
 *   the bottom. Keep the player already there, and the newcomer takes the next
 *   spot. Prefer the newcomer, and he moves up one and is asked about against
 *   the player now directly above him, climbing until the reader keeps the
 *   player above. A newcomer who passes rank 1 is simply placed first.
 *
 *   After `winsBeforePrompt` straight wins (three by default) the run stops and
 *   asks: place him at a rank, or keep comparing one at a time. Choosing to keep
 *   comparing is offered again after each further run of that many wins, so the
 *   reader is never locked into eighty questions about one player.
 *
 * DEPTH COUNTS PLACED PLAYERS. A player the reader leaves off does not use a
 * slot, and the next seed player is pulled in.
 *
 * DEFENDERS JOIN AS A SECOND PASS on an overall board with defenders switched
 * on: offense and defense have no common scale to interleave from, so once the
 * offensive run is done each defender enters at the bottom and climbs.
 */

import { MAX_TIER_BREAKS } from "@/lib/ranking-boards";

/** Everything fixed at the start of a run. */
export type RunSetup = {
  /** Seed player ids in order (the first pass). */
  seed: string[];
  /** Defenders for the second pass, in seed order. Empty when not used. */
  secondPass: string[];
  /** The board's order when the run began (empty for a new board). */
  initialBoard: string[];
  /** 1-based rank the run starts re-checking from. Ranks above it are kept
   * as they are. Only meaningful with a non-empty initialBoard; a run on a new
   * board passes 1. */
  startRank: number;
  /** How many players the first pass places before it stops pulling seeds. */
  depth: number;
  winsBeforePrompt: number;
  /** A guest's hard ceiling on placed players, or null for an account. */
  cap: number | null;
  /** Tier lines already on the board, kept at their ranks by the tier pass. */
  initialBreaks: number[];
};

export type Answer =
  | { a: "prefer" }
  | { a: "keep" }
  | { a: "skip" }
  | { a: "leave" }
  | { a: "place"; rank: number }
  | { a: "continue" }
  | { a: "extend"; by: number }
  | { a: "tiers" }
  | { a: "tier"; yes: boolean }
  | { a: "tiers_done" };

export type RunPhase = "compare" | "prompt" | "done" | "tiers" | "finished";

/** What the last answer did, for the result line and the live region. */
export type RunEvent =
  | { kind: "placed"; playerId: string; rank: number; how: "kept" | "skipped" | "placed" | "top" }
  | { kind: "climbed"; playerId: string; passed: string }
  | { kind: "left_off"; playerId: string }
  | { kind: "prompt"; playerId: string; streak: number }
  | { kind: "extended"; depth: number }
  | { kind: "tier"; afterRank: number; drawn: boolean }
  | { kind: "tiers_started" }
  | { kind: "tiers_done" }
  | null;

export type RunState = {
  phase: RunPhase;
  /** Placed players in board order. The climbing newcomer is NOT in here. */
  board: string[];
  /** The newcomer being asked about, and where he would sit if the run
   * stopped now (0-based index into `board`, where board.length is "below
   * everyone"). */
  current: { playerId: string; pos: number; streak: number; promptAt: number } | null;
  /** The player the current question compares him with, or null. */
  opponent: string | null;
  leftOff: string[];
  depth: number;
  answered: number;
  /** True when a guest has reached the cap and nothing more can be placed. */
  capReached: boolean;
  /** Players still waiting in the first pass (re-checks and seeds). */
  remainingFirstPass: number;
  /** Players still waiting in the second pass. */
  remainingSecondPass: number;
  /** Players from the ORIGINAL board not yet re-checked, in their old order.
   * They are still on the board; a checkpoint must keep them. */
  pendingRecheck: string[];
  /** The tier pass: the gap being asked about (a line would fall after this
   * rank), and the lines so far. */
  tierPass: { gap: number | null; breaks: number[] };
  event: RunEvent;
};

export type FoldError = { index: number; reason: string };

type Queue = { ids: string[]; next: number };

function buildInitial(setup: RunSetup) {
  const start = Math.max(1, Math.min(setup.startRank, setup.initialBoard.length + 1));
  const fixedTop = setup.initialBoard.slice(0, start - 1);
  const recheck = setup.initialBoard.slice(start - 1);
  const onBoard = new Set(setup.initialBoard);
  const secondIds = new Set(setup.secondPass);
  const seeds = setup.seed.filter((id) => !onBoard.has(id) && !secondIds.has(id));
  const second = setup.secondPass.filter((id) => !onBoard.has(id));
  return { fixedTop, recheck, seeds, second };
}

/** A fresh, stable state from the setup alone. */
export function initialState(setup: RunSetup): RunState {
  const { state } = foldRun(setup, []);
  return state;
}

/**
 * Fold a log into the run's state. Stops at the first answer that does not
 * apply and reports it, so a corrupted log can never produce a state no reader
 * built. The server refuses to append such an answer in the first place.
 */
export function foldRun(
  setup: RunSetup,
  answers: readonly Answer[],
): { state: RunState; error: FoldError | null } {
  const { fixedTop, recheck, seeds, second } = buildInitial(setup);
  const board = [...fixedTop];
  const first: Queue = { ids: [...recheck, ...seeds], next: 0 };
  const recheckCount = recheck.length;
  const secondQ: Queue = { ids: second, next: 0 };
  let depth = Math.max(setup.depth, 0);
  const leftOff: string[] = [];
  let current: RunState["current"] = null;
  let phase: RunPhase = "compare";
  let answered = 0;
  let event: RunEvent = null;
  let tierGap: number | null = null;
  let tierBreaks: number[] = [];
  const threshold = Math.max(1, setup.winsBeforePrompt);

  const atCap = () => setup.cap !== null && board.length >= setup.cap;
  // Read through getters: the closures below reassign these, and TypeScript
  // would otherwise narrow them to whatever the loop last assigned directly.
  const getCurrent = (): RunState["current"] => current;
  const getPhase = (): RunPhase => phase;

  /** Pull the next newcomer, or finish the compare phase. */
  const advance = () => {
    current = null;
    if (atCap()) {
      phase = "done";
      return;
    }
    let id: string | undefined;
    const inRecheck = first.next < recheckCount;
    if (first.next < first.ids.length && (inRecheck || board.length < depth)) {
      id = first.ids[first.next];
      first.next += 1;
    } else if (secondQ.next < secondQ.ids.length) {
      id = secondQ.ids[secondQ.next];
      secondQ.next += 1;
    }
    if (id === undefined) {
      phase = "done";
      return;
    }
    if (board.length === 0) {
      // Nobody to compare him with: he is rank 1 without a question.
      board.push(id);
      advance();
      return;
    }
    current = { playerId: id, pos: board.length, streak: 0, promptAt: threshold };
    phase = "compare";
  };

  const place = (rank0: number, how: "kept" | "skipped" | "placed" | "top") => {
    const c = current!;
    board.splice(rank0, 0, c.playerId);
    event = { kind: "placed", playerId: c.playerId, rank: rank0 + 1, how };
    advance();
  };

  advance();

  for (let i = 0; i < answers.length; i += 1) {
    const ans = answers[i];
    const fail = (reason: string) => ({
      state: snapshot(),
      error: { index: i, reason },
    });

    const ph = getPhase();
    if (ph === "compare") {
      const c = getCurrent();
      if (!c) return fail("No question is open.");
      switch (ans.a) {
        case "prefer": {
          const passed = board[c.pos - 1];
          c.pos -= 1;
          c.streak += 1;
          if (c.pos === 0) {
            place(0, "top");
          } else if (c.streak >= c.promptAt) {
            phase = "prompt";
            event = { kind: "prompt", playerId: c.playerId, streak: c.streak };
          } else {
            event = { kind: "climbed", playerId: c.playerId, passed };
          }
          break;
        }
        case "keep":
          place(c.pos, "kept");
          break;
        case "skip":
          place(c.pos, "skipped");
          break;
        case "leave":
          leftOff.push(c.playerId);
          event = { kind: "left_off", playerId: c.playerId };
          advance();
          break;
        case "place": {
          if (!Number.isInteger(ans.rank) || ans.rank < 1 || ans.rank > c.pos) {
            return fail("That rank is not above his current spot.");
          }
          place(ans.rank - 1, "placed");
          break;
        }
        default:
          return fail("That answer does not fit a question.");
      }
    } else if (ph === "prompt") {
      const c = getCurrent()!;
      if (ans.a === "place") {
        if (!Number.isInteger(ans.rank) || ans.rank < 1 || ans.rank > c.pos) {
          return fail("That rank is not above his current spot.");
        }
        place(ans.rank - 1, "placed");
      } else if (ans.a === "continue") {
        c.promptAt = c.streak + threshold;
        phase = "compare";
        event = null;
      } else if (ans.a === "leave") {
        leftOff.push(c.playerId);
        event = { kind: "left_off", playerId: c.playerId };
        advance();
      } else {
        return fail("Choose a rank or keep comparing.");
      }
    } else if (ph === "done") {
      if (ans.a === "extend") {
        if (!Number.isInteger(ans.by) || ans.by < 1 || ans.by > 500) {
          return fail("That is not a valid extension.");
        }
        if (setup.cap !== null && board.length >= setup.cap) {
          return fail("The guest limit is reached.");
        }
        depth = Math.max(depth, board.length) + ans.by;
        event = { kind: "extended", depth };
        advance();
      } else if (ans.a === "tiers") {
        if (board.length < 2) return fail("A tier line needs two players.");
        phase = "tiers";
        tierBreaks = [...setup.initialBreaks].filter((b) => b >= 1 && b < board.length);
        tierGap = nextGap(0, tierBreaks, board.length);
        event = { kind: "tiers_started" };
        if (tierGap === null) phase = "finished";
      } else if (ans.a === "tiers_done") {
        phase = "finished";
        event = { kind: "tiers_done" };
      } else {
        return fail("The run is finished.");
      }
    } else if (ph === "tiers") {
      if (ans.a === "tier" && tierGap !== null) {
        const after = tierGap;
        if (ans.yes && tierBreaks.length < MAX_TIER_BREAKS) {
          tierBreaks = [...tierBreaks, after].sort((x, y) => x - y);
        }
        event = { kind: "tier", afterRank: after, drawn: ans.yes };
        tierGap = nextGap(after, tierBreaks, board.length);
        if (tierGap === null) phase = "finished";
      } else if (ans.a === "tiers_done") {
        phase = "finished";
        tierGap = null;
        event = { kind: "tiers_done" };
      } else {
        return fail("Answer the tier question or end the tier pass.");
      }
    } else {
      return fail("The run is finished.");
    }
    answered += 1;
  }

  return { state: snapshot(), error: null };

  function snapshot(): RunState {
    const cur = current as RunState["current"];
    const opponent =
      cur && (phase === "compare" || phase === "prompt") && cur.pos > 0
        ? board[cur.pos - 1]
        : null;
    return {
      phase,
      board: [...board],
      current: cur ? { ...cur } : null,
      opponent,
      leftOff: [...leftOff],
      depth,
      answered,
      capReached: atCap() && phase !== "compare" && phase !== "prompt",
      remainingFirstPass: Math.max(0, first.ids.length - first.next),
      remainingSecondPass: Math.max(0, secondQ.ids.length - secondQ.next),
      pendingRecheck: first.ids.slice(Math.min(first.next, recheckCount), recheckCount),
      tierPass: { gap: tierGap, breaks: [...tierBreaks] },
      event,
    };
  }
}

/** The next gap after `after` without a line already on it. */
function nextGap(after: number, breaks: readonly number[], length: number): number | null {
  for (let g = after + 1; g < length; g += 1) {
    if (!breaks.includes(g)) return g;
  }
  return null;
}

/** The board as it would stand if the run stopped now: the climbing newcomer
 * sits at his current spot. This is what a checkpoint flush writes and what
 * the board-so-far list draws. */
export function provisionalBoard(state: RunState): string[] {
  const out = [...state.board];
  if (state.current && (state.phase === "compare" || state.phase === "prompt")) {
    out.splice(state.current.pos, 0, state.current.playerId);
  }
  return out;
}

/**
 * The board to WRITE at a checkpoint or on stop: the provisional board, then
 * every original player not yet re-checked, in the order they already had. A
 * run over an existing board must never drop a player just because the run
 * has not reached him yet.
 */
export function boardForFlush(state: RunState): string[] {
  const out = provisionalBoard(state);
  const seen = new Set(out);
  for (const id of state.pendingRecheck) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/**
 * Check one new answer against the state the log folds to. `pair` is what the
 * client says was on screen ([newcomer, opponent]); a comparative answer about
 * any other pair is stale (a double click, a second tab) and is refused rather
 * than applied to a question the reader never saw.
 */
export function validateAnswer(
  setup: RunSetup,
  answers: readonly Answer[],
  next: Answer,
  pair: readonly [string, string | null] | null,
): { ok: true; state: RunState } | { ok: false; reason: string; state: RunState } {
  const before = foldRun(setup, answers);
  if (before.error) {
    return { ok: false, reason: "This run could not be read.", state: before.state };
  }
  const s = before.state;
  const comparative =
    next.a === "prefer" || next.a === "keep" || next.a === "skip" || next.a === "leave" ||
    next.a === "place" || next.a === "continue";
  if (comparative) {
    if (!s.current || !pair) {
      return { ok: false, reason: "That question has already been answered.", state: s };
    }
    if (pair[0] !== s.current.playerId || (pair[1] ?? null) !== s.opponent) {
      return { ok: false, reason: "That question has already been answered.", state: s };
    }
  }
  if (next.a === "tier" && pair && s.tierPass.gap !== null) {
    // For a tier question the pair is the two players either side of the gap.
    const g = s.tierPass.gap;
    if (pair[0] !== s.board[g - 1] || pair[1] !== s.board[g]) {
      return { ok: false, reason: "That question has already been answered.", state: s };
    }
  }
  const after = foldRun(setup, [...answers, next]);
  if (after.error) return { ok: false, reason: after.error.reason, state: s };
  return { ok: true, state: after.state };
}

/** Parse one untrusted answer. Anything malformed is null. */
export function parseAnswer(raw: unknown): Answer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.a) {
    case "prefer":
    case "keep":
    case "skip":
    case "leave":
    case "continue":
    case "tiers":
    case "tiers_done":
      return { a: r.a };
    case "place":
      return Number.isInteger(r.rank) ? { a: "place", rank: r.rank as number } : null;
    case "extend":
      return Number.isInteger(r.by) ? { a: "extend", by: r.by as number } : null;
    case "tier":
      return typeof r.yes === "boolean" ? { a: "tier", yes: r.yes } : null;
    default:
      return null;
  }
}

/** Parse a stored log. A malformed entry ends the log there: the fold never
 * sees an answer it cannot type. */
export function parseAnswerLog(raw: unknown): Answer[] {
  if (!Array.isArray(raw)) return [];
  const out: Answer[] = [];
  for (const entry of raw) {
    const a = parseAnswer(entry);
    if (!a) break;
    out.push(a);
  }
  return out;
}

/** "Player 37 of 100": placed players over the run's planned total. */
export function runProgress(setup: RunSetup, state: RunState): { placed: number; total: number } {
  const placed = provisionalBoard(state).length - (state.current ? 1 : 0);
  const plannedFirst = Math.max(state.depth, setup.initialBoard.length);
  const total =
    setup.cap !== null
      ? Math.min(setup.cap, plannedFirst + setup.secondPass.length)
      : plannedFirst + setup.secondPass.length;
  return { placed, total: Math.max(total, placed) };
}
