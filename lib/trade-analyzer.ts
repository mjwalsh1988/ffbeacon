import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { LeagueDraftSlotIndex } from "@/lib/league-pick-slots";
import type { StartupPickIndex } from "@/lib/league-startup-picks";
import { describeUnresolved } from "@/lib/startup-draft";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Trade analyzer.
 *
 * Given a Sleeper-style trade transaction and a league context (resolved
 * format + source), compute what each team received and a value-weighted
 * verdict.
 *
 * Player values come from player_value_trends for the (format, source).
 * Draft pick values come from draft_pick_values for the (format, KTC),
 * picks are ALWAYS valued via KTC because FantasyCalc doesn't publish them.
 * The UI surfaces this via the LeagueContext.pickSource footnote.
 *
 * A DYNASTY STARTUP PICK IS NOT PRICED FROM THAT TABLE.
 * `draft_pick_values` holds ROOKIE pick values and only rounds 1 to 4, so a
 * startup pick read from it came back either as a rookie price (wrong by
 * thousands of points) or as nothing at all (every startup pick past round 4).
 * When the caller supplies a startup index, a startup pick is instead valued as
 * the player who was actually taken at that seat. One that cannot be resolved is
 * marked noValue with a reason, never handed back to the rookie table.
 *
 * The verdict thresholds are based on what feels intuitively fair without
 * being too aggressive:
 *   abs(differential) / max(sideA, sideB) ≤ 5%   → "Even trade"
 *   abs(differential) / max(sideA, sideB) ≤ 15%  → "Slight edge to {winner}"
 *   anything larger                              → "{winner} won the trade"
 */

export type TradePlayer = {
  /** Sleeper player id (string). */
  sleeperId: string;
  /** Our internal player_id (uuid). null when we can't resolve the player. */
  playerId: string | null;
  name: string;
  position: string | null;
  team: string | null;
  /** Numeric value in the league's resolved format from the user's source.
   * 0 when we have no value row (e.g. retired player, off-season acquisition
   * with sparse history). UI may want to call out "no value" separately. */
  value: number;
  /** True when value === 0 because we couldn't find a trend row. UI uses
   * this to draw a muted/dashed chip instead of pretending the player is
   * worth literally zero. */
  noValue: boolean;
};

export type TradePick = {
  season: number;
  round: number;
  /** "early" | "mid" | "late" | "unknown". Defaults to "mid" when Sleeper
   * doesn't supply a slot. */
  pickPosition: "early" | "mid" | "late" | "unknown";
  /** Sleeper roster_id of the team that owns the original draft slot
   * (used for "via Team X" labels). */
  originalRosterId: number | null;
  /** Resolved draft slot (1..N) when the season's draft is scheduled. Null
   * for future-season picks where Sleeper hasn't published slot_to_roster_id. */
  slot: number | null;
  /** "{round}.{slot padded}" label (e.g. "1.04"). Null when slot unknown. */
  pickLabel: string | null;
  /** Numeric value via the pick source (KTC). 0 when we have no row. */
  value: number;
  noValue: boolean;
  /**
   * Set when this pick belongs to a dynasty STARTUP draft, in which case its
   * value above came from the player at that seat rather than from the rookie
   * pick table. The UI renders the player so a reader can see what the pick
   * actually became.
   */
  startup?: {
    /** The player the seat produced. Null when the pick could not be resolved. */
    playerName: string | null;
    playerSleeperId: string | null;
    position: string | null;
    /** True when the player came from the ADP simulation rather than a selection. */
    simulated: boolean;
    /** Reader-facing reason, set only when the pick could not be resolved. */
    unresolvedNote: string | null;
  };
};

export type TradeSide = {
  rosterId: number;
  teamName: string;
  ownerHandle: string | null;
  players: TradePlayer[];
  picks: TradePick[];
  /** Sum of all received values (player + pick). */
  totalValue: number;
};

export type TradeAnalysis = {
  /** Two-or-more-sided breakdown of who got what. */
  sides: TradeSide[];
  /** Sum of every side's totalValue. Useful for context. */
  combinedValue: number;
  /** Verdict label + winning roster (if any). */
  verdict: TradeVerdict;
  /** True when at least one player or pick lacked a value row. Tells the
   * UI to render a "Some values missing, analysis may be incomplete" note. */
  hasMissingValues: boolean;
  /** Snapshot of the inputs used so the OG image route can re-render
   * identical content without re-querying. */
  context: {
    formatSlug: string;
    formatDisplay: string;
    sourceSlug: string;
    sourceDisplay: string;
    pickSourceSlug: string | null;
    pickSourceDisplay: string | null;
  };
};

export type TradeVerdict =
  | { label: "Even trade"; winnerRosterId: null; differential: 0; differentialPct: 0 }
  | {
      label: "Slight edge";
      winnerRosterId: number;
      differential: number;
      differentialPct: number;
    }
  | {
      label: "Won the trade";
      winnerRosterId: number;
      differential: number;
      differentialPct: number;
    };

type SleeperAdds = Record<string, number | string> | null | undefined;
type SleeperPickRaw = {
  season?: number | string;
  round?: number;
  roster_id?: number;
  owner_id?: number;
  previous_owner_id?: number;
  pick_position?: string;
};

type RosterIdentity = {
  teamName: string;
  ownerHandle: string | null;
  avatarId?: string | null;
};

export type TradeAnalyzerInputs = {
  /** League row id (leagues.id uuid). */
  leagueRowId: string;
  adds: SleeperAdds;
  draftPicks: unknown;
  /** Identity map from sleeper_roster_id → display label. Sourced from
   * league_users.team_name / display_name. */
  rosterIdentities: Record<number, RosterIdentity>;
  /** Optional pre-loaded slot index. When supplied, every TradePick gets a
   * concrete slot/pickLabel for scheduled drafts; otherwise both stay null. */
  slotIndex?: LeagueDraftSlotIndex | null;
  /**
   * Optional startup-pick index. When supplied, a pick belonging to a dynasty
   * startup draft is valued as the player at that seat instead of from the
   * rookie pick table. Without it every pick keeps the old behavior, so callers
   * that have not been migrated are unaffected.
   */
  startupIndex?: StartupPickIndex | null;
  /**
   * When Sleeper recorded this trade, ISO. Needed only when the pick's season
   * ran BOTH a startup and a rookie draft, where the round number alone cannot
   * say which one a "2026 round 1" belongs to.
   */
  tradedAtSleeper?: string | null;
  /** Resolved league context (from lib/league-format-resolution). */
  context: {
    formatConfigId: string;
    formatSlug: string;
    formatDisplay: string;
    sourceSlug: string;
    sourceDisplay: string;
    pickSourceSlug: string | null;
    pickSourceDisplay: string | null;
  };
};

export async function analyzeTrade(
  supabase: AnySupabase,
  inputs: TradeAnalyzerInputs,
): Promise<TradeAnalysis | null> {
  const {
    adds,
    draftPicks,
    rosterIdentities,
    slotIndex = null,
    startupIndex = null,
    tradedAtSleeper = null,
    context,
  } = inputs;
  const addEntries = parseAdds(adds);
  const pickEntries = parsePicks(draftPicks);
  const parsedTradedAt = tradedAtSleeper ? Date.parse(tradedAtSleeper) : NaN;
  const tradedAtMs = Number.isFinite(parsedTradedAt) ? parsedTradedAt : null;

  // No usable content, surface a null analysis so the UI can render a
  // simple "no players or picks" placeholder.
  if (addEntries.length === 0 && pickEntries.length === 0) return null;

  // Resolve every startup pick first. This is pure (the index is already built)
  // so it costs nothing and it tells us which extra players the value query has
  // to cover, which lets the reads below run in two waves instead of four.
  const startupByPick = new Map<
    number,
    ReturnType<StartupPickIndex["resolve"]>
  >();
  const startupPlayerIds = new Set<string>();
  if (startupIndex) {
    pickEntries.forEach((entry, i) => {
      const resolved = startupIndex.resolve({
        season: entry.season,
        round: entry.round,
        originalRosterId: entry.originalRosterId,
        tradedAtMs,
      });
      if (!resolved) return;
      startupByPick.set(i, resolved);
      if (resolved.substitution.kind === "player") {
        startupPlayerIds.add(resolved.substitution.playerId);
      }
    });
  }

  // Pick values keyed by `${season}|${round}|${pickPosition}`. We honor the
  // pickSourceSlug from context (always KTC today). When no pick source is
  // configured (every active source publishes picks), default to the main
  // sourceSlug.
  const pickSourceForValues = context.pickSourceSlug ?? context.sourceSlug;

  // Wave one: three reads that depend on nothing but the inputs.
  const sleeperIds = Array.from(new Set(addEntries.map((e) => e.sleeperId)));
  const [playerMeta, startupMeta, pickValues] = await Promise.all([
    // sleeper_id -> (player_id, name, position, team)
    loadPlayerMeta(supabase, sleeperIds),
    // player_id -> meta, for the players startup picks resolved into.
    loadPlayerMetaByIds(supabase, Array.from(startupPlayerIds)),
    loadPickValues(supabase, context.formatConfigId, pickSourceForValues),
  ]);

  // Wave two: values, which need the player ids wave one resolved.
  const playerIds = Array.from(
    new Set([
      ...Array.from(playerMeta.values())
        .map((p) => p.playerId)
        .filter((id): id is string => Boolean(id)),
      ...startupPlayerIds,
    ]),
  );
  const playerValues = await loadPlayerValues(
    supabase,
    playerIds,
    context.formatConfigId,
    context.sourceSlug,
  );

  // A trade made AFTER the draft can move the drafted player AND the spent pick
  // that produced him. Counting both would add one player's value twice to one
  // side. The player is the real asset, so the pick defers to him.
  //
  // Tracked PER SIDE and per player, so a pick that resolves to a player the
  // OTHER side received is still worth something, and two pick descriptors
  // landing on the same seat cannot both be paid.
  const countedPlayerBySide = new Map<number, Set<string>>();
  for (const entry of addEntries) {
    const playerId = playerMeta.get(entry.sleeperId)?.playerId;
    if (!playerId) continue;
    const seen = countedPlayerBySide.get(entry.rosterId) ?? new Set<string>();
    seen.add(playerId);
    countedPlayerBySide.set(entry.rosterId, seen);
  }

  // Group adds and picks by receiving roster.
  const sideByRoster = new Map<number, TradeSide>();
  let combinedValue = 0;
  let hasMissingValues = false;

  for (const entry of addEntries) {
    const rosterId = entry.rosterId;
    const meta = playerMeta.get(entry.sleeperId);
    const playerId = meta?.playerId ?? null;
    const value = playerId ? (playerValues.get(playerId) ?? 0) : 0;
    const noValue = value === 0;
    if (noValue) hasMissingValues = true;

    const player: TradePlayer = {
      sleeperId: entry.sleeperId,
      playerId,
      name: meta?.name ?? entry.sleeperId,
      position: meta?.position ?? null,
      team: meta?.team ?? null,
      value,
      noValue,
    };

    const side = ensureSide(sideByRoster, rosterId, rosterIdentities);
    side.players.push(player);
    side.totalValue += value;
    combinedValue += value;
  }

  for (const [i, pickEntry] of pickEntries.entries()) {
    const ownerId = pickEntry.ownerId;
    if (ownerId == null) continue; // unattributed picks skip the analysis

    const startup = startupByPick.get(i) ?? null;

    const slot =
      startup?.seat ??
      (slotIndex && pickEntry.originalRosterId != null
        ? slotIndex.slotFor(pickEntry.season, pickEntry.originalRosterId)
        : null);
    const pickLabel =
      slot != null
        ? `${pickEntry.round}.${String(slot).padStart(2, "0")}`
        : null;

    let value: number;
    let noValue: boolean;
    let startupDetail: TradePick["startup"];

    if (startup) {
      // A startup pick is worth the player at its seat. It is never priced from
      // draft_pick_values, which publishes rookie picks only.
      if (startup.substitution.kind === "player") {
        const { playerId, simulated } = startup.substitution;
        const meta = startupMeta.get(playerId) ?? null;

        // The player this pick became is already counted on THIS side, either
        // because he moved in the same trade or because an earlier pick resolved
        // to the same seat. The pick conveys nothing further. Priced at zero but
        // NOT marked noValue: this is a deliberate zero, and flagging it as a
        // missing value would put a "some values are missing" caveat on a trade
        // whose values are all present.
        const seen = countedPlayerBySide.get(ownerId) ?? new Set<string>();
        const duplicate = seen.has(playerId);
        seen.add(playerId);
        countedPlayerBySide.set(ownerId, seen);

        value = duplicate ? 0 : (playerValues.get(playerId) ?? 0);
        noValue = !duplicate && value === 0;
        startupDetail = {
          playerName: meta?.name ?? null,
          playerSleeperId: meta?.sleeperId ?? null,
          position: meta?.position ?? null,
          simulated,
          unresolvedNote: duplicate
            ? "Counted once, this player is already on this side of the trade"
            : null,
        };
      } else {
        value = 0;
        noValue = true;
        startupDetail = {
          playerName: null,
          playerSleeperId: null,
          position: null,
          simulated: false,
          unresolvedNote: describeUnresolved(startup.substitution.reason),
        };
      }
    } else {
      const key = pickKey(pickEntry.season, pickEntry.round, pickEntry.pickPosition);
      value = pickValues.get(key) ?? 0;
      noValue = value === 0;
      startupDetail = undefined;
    }

    if (noValue) hasMissingValues = true;

    const pick: TradePick = {
      season: pickEntry.season,
      round: pickEntry.round,
      pickPosition: pickEntry.pickPosition,
      originalRosterId: pickEntry.originalRosterId,
      slot,
      pickLabel,
      value,
      noValue,
      ...(startupDetail ? { startup: startupDetail } : {}),
    };

    const side = ensureSide(sideByRoster, ownerId, rosterIdentities);
    side.picks.push(pick);
    side.totalValue += value;
    combinedValue += value;
  }

  const sides = Array.from(sideByRoster.values()).sort(
    (a, b) => b.totalValue - a.totalValue,
  );

  for (const side of sides) {
    side.totalValue = round2(side.totalValue);
  }
  combinedValue = round2(combinedValue);

  return {
    sides,
    combinedValue,
    verdict: computeVerdict(sides),
    hasMissingValues,
    context: {
      formatSlug: context.formatSlug,
      formatDisplay: context.formatDisplay,
      sourceSlug: context.sourceSlug,
      sourceDisplay: context.sourceDisplay,
      pickSourceSlug: context.pickSourceSlug,
      pickSourceDisplay: context.pickSourceDisplay,
    },
  };
}

function ensureSide(
  map: Map<number, TradeSide>,
  rosterId: number,
  identities: Record<number, RosterIdentity>,
): TradeSide {
  const existing = map.get(rosterId);
  if (existing) return existing;
  const id = identities[rosterId];
  const side: TradeSide = {
    rosterId,
    teamName: id?.teamName ?? `Team ${rosterId}`,
    ownerHandle: id?.ownerHandle ?? null,
    players: [],
    picks: [],
    totalValue: 0,
  };
  map.set(rosterId, side);
  return side;
}

function computeVerdict(sides: TradeSide[]): TradeVerdict {
  if (sides.length < 2) {
    return { label: "Even trade", winnerRosterId: null, differential: 0, differentialPct: 0 };
  }
  const top = sides[0];
  const next = sides[1];
  const differential = round2(top.totalValue - next.totalValue);
  const ceiling = Math.max(top.totalValue, next.totalValue);
  const differentialPct = ceiling > 0 ? round2((differential / ceiling) * 100) : 0;

  if (differential <= 0 || differentialPct <= 5) {
    return { label: "Even trade", winnerRosterId: null, differential: 0, differentialPct: 0 };
  }
  if (differentialPct <= 15) {
    return { label: "Slight edge", winnerRosterId: top.rosterId, differential, differentialPct };
  }
  return { label: "Won the trade", winnerRosterId: top.rosterId, differential, differentialPct };
}

function parseAdds(adds: SleeperAdds): Array<{ sleeperId: string; rosterId: number }> {
  if (!adds || typeof adds !== "object") return [];
  const out: Array<{ sleeperId: string; rosterId: number }> = [];
  for (const [sleeperId, rosterIdVal] of Object.entries(adds)) {
    const rosterId =
      typeof rosterIdVal === "number"
        ? rosterIdVal
        : typeof rosterIdVal === "string"
          ? Number.parseInt(rosterIdVal, 10)
          : NaN;
    if (Number.isNaN(rosterId)) continue;
    if (!sleeperId || sleeperId === "0") continue;
    out.push({ sleeperId, rosterId });
  }
  return out;
}

function parsePicks(input: unknown): Array<{
  season: number;
  round: number;
  pickPosition: "early" | "mid" | "late" | "unknown";
  ownerId: number | null;
  originalRosterId: number | null;
}> {
  const arr = normalizePickArray(input);
  const out: Array<{
    season: number;
    round: number;
    pickPosition: "early" | "mid" | "late" | "unknown";
    ownerId: number | null;
    originalRosterId: number | null;
  }> = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as SleeperPickRaw;
    const season = typeof p.season === "number" ? p.season : Number.parseInt(String(p.season ?? ""), 10);
    const round = typeof p.round === "number" ? p.round : NaN;
    if (!Number.isFinite(season) || !Number.isFinite(round)) continue;
    const pickPosition = parsePickPosition(p.pick_position);
    const ownerId = typeof p.owner_id === "number" ? p.owner_id : null;
    const originalRosterId =
      typeof p.roster_id === "number"
        ? p.roster_id
        : typeof p.previous_owner_id === "number"
          ? p.previous_owner_id
          : null;
    out.push({ season, round, pickPosition, ownerId, originalRosterId });
  }
  return out;
}

function normalizePickArray(input: unknown): unknown[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "object") return Object.values(input as Record<string, unknown>);
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});
    } catch {
      return [];
    }
  }
  return [];
}

function parsePickPosition(raw: string | undefined): "early" | "mid" | "late" | "unknown" {
  if (raw === "early" || raw === "mid" || raw === "late") return raw;
  return "mid";
}

function pickKey(season: number, round: number, pos: string): string {
  return `${season}|${round}|${pos}`;
}

async function loadPlayerMeta(
  supabase: AnySupabase,
  sleeperIds: string[],
): Promise<
  Map<
    string,
    {
      playerId: string | null;
      name: string;
      position: string | null;
      team: string | null;
    }
  >
> {
  const out = new Map<
    string,
    { playerId: string | null; name: string; position: string | null; team: string | null }
  >();
  if (sleeperIds.length === 0) return out;
  // Defense-in-depth: only interpolate numeric ids into the PostgREST
  // filter language. See lib/league-transactions-data.ts for context.
  const safeIds = sleeperIds.filter((id) => /^\d+$/.test(id));
  const CHUNK = 200;
  for (let i = 0; i < safeIds.length; i += CHUNK) {
    const chunk = safeIds.slice(i, i + CHUNK);
    const ors = chunk
      .flatMap((id) => [
        `external_ids->>sleeper.eq.${id}`,
        `slug.like.*-${id}`,
      ])
      .join(",");
    const { data: rows } = await (supabase as SupabaseClient<Database>)
      .from("players")
      .select("id, slug, full_name, first_name, last_name, position, team, external_ids")
      .or(ors);
    for (const r of rows ?? []) {
      const ext = (r.external_ids as Record<string, unknown>) ?? {};
      const fromExternal = typeof ext.sleeper === "string" ? ext.sleeper : null;
      const tail = (r.slug as string).match(/-(\d+)$/)?.[1] ?? null;
      const sid = fromExternal ?? tail;
      if (!sid || !chunk.includes(sid)) continue;
      if (!out.has(sid)) {
        out.set(sid, {
          playerId: r.id,
          name: r.full_name ?? (`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || sid),
          position: r.position ?? null,
          team: r.team ?? null,
        });
      }
    }
  }
  // Anything still unresolved becomes a placeholder so the UI can render
  // the sleeper id rather than throwing.
  for (const sid of sleeperIds) {
    if (!out.has(sid)) {
      out.set(sid, { playerId: null, name: sid, position: null, team: null });
    }
  }
  return out;
}

/**
 * Player meta keyed by FF Beacon player id.
 *
 * Startup picks arrive already resolved to a player id (draft_selections stores
 * the uuid), so they need the reverse of loadPlayerMeta's sleeper-id lookup.
 *
 * `.in()` is NOT parameterized: PostgREST builds a quoted list and does not
 * escape an embedded quote. It is safe here only because the ids are uuids read
 * from `draft_selections.player_id`, a typed uuid column with a foreign key to
 * `players`. A caller passing anything looser would need the same filtering
 * loadPlayerMeta applies to sleeper ids.
 */
async function loadPlayerMetaByIds(
  supabase: AnySupabase,
  playerIds: string[],
): Promise<
  Map<string, { name: string; position: string | null; team: string | null; sleeperId: string | null }>
> {
  const out = new Map<
    string,
    { name: string; position: string | null; team: string | null; sleeperId: string | null }
  >();
  if (playerIds.length === 0) return out;
  const CHUNK = 200;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data } = await (supabase as SupabaseClient<Database>)
      .from("players")
      .select("id, full_name, first_name, last_name, position, team, external_ids")
      .in("id", chunk);
    for (const row of data ?? []) {
      const ext = (row.external_ids as Record<string, unknown>) ?? {};
      const rawSleeper = ext.sleeper;
      out.set(row.id, {
        name:
          row.full_name ?? (`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Unknown player"),
        position: row.position ?? null,
        team: row.team ?? null,
        sleeperId:
          typeof rawSleeper === "string" || typeof rawSleeper === "number"
            ? String(rawSleeper)
            : null,
      });
    }
  }
  return out;
}

async function loadPlayerValues(
  supabase: AnySupabase,
  playerIds: string[],
  formatConfigId: string,
  source: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (playerIds.length === 0) return map;
  const CHUNK = 300;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data } = await (supabase as SupabaseClient<Database>)
      .from("player_value_trends")
      .select("player_id, current_value")
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .in("player_id", chunk);
    for (const row of data ?? []) {
      map.set(row.player_id, Number(row.current_value));
    }
  }
  return map;
}

async function loadPickValues(
  supabase: AnySupabase,
  formatConfigId: string,
  source: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data } = await (supabase as SupabaseClient<Database>)
    .from("draft_pick_values")
    .select("season, round, pick_position, value, captured_at")
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .order("captured_at", { ascending: false });
  for (const row of data ?? []) {
    const key = pickKey(Number(row.season), Number(row.round), String(row.pick_position));
    if (!map.has(key)) map.set(key, Number(row.value));
  }
  return map;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
