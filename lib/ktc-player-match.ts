/**
 * Which players row a KeepTradeCut entry belongs to.
 *
 * KTC is matched by name and position, because KTC ids only exist on rows a
 * previous run already matched. A plain Map keyed on "name|position" is wrong
 * the moment two rows share that key: the last row loaded wins, silently, and
 * the winner can change between runs. That is how KTC id 1570 (Frank Gore Jr.,
 * BUF, born 2002) ended up stamped on Frank Gore (Sleeper 232, born 1983,
 * retired): the suffix is stripped by normalizeKtcName, both rows read
 * "frank gore|RB", and in May the retired one happened to win. From then on
 * every run matched the right row by name, tried to write ktc=1570 onto it,
 * hit the unique index and logged "ktc id collision" instead.
 *
 * Kyle Williams (KTC 1812) is the same failure: the New England rookie's
 * values were landing on the 1988-born retired row by 2026-09.
 *
 * The resolver keeps EVERY candidate for a key and decides between them:
 *   1. one candidate: that row;
 *   2. several: the one whose team matches KTC's team, if exactly one does;
 *   3. otherwise the one row that has a team at all, if exactly one does
 *      (KTC lists current players; a retired namesake has no team);
 *   4. otherwise the one already carrying this KTC id. This comes LAST on
 *      purpose: a stored id is only as good as the run that stamped it, and
 *      both ids above were stamped by exactly this bug;
 *   5. otherwise no match. An ambiguous name is reported, never guessed.
 */

export type KtcMatchPlayer = {
  id: string;
  external_ids: unknown;
  first_name: string;
  last_name: string;
  position: string;
  team: string | null;
};

export type KtcMatchEntry = {
  playerID: number | string;
  playerName: string;
  team: string | null;
};

export function normalizeKtcName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .trim();
}

function storedKtcId(externalIds: unknown): string | null {
  if (!externalIds || typeof externalIds !== "object") return null;
  const v = (externalIds as Record<string, unknown>).ktc;
  return typeof v === "string" || typeof v === "number" ? String(v) : null;
}

/**
 * KTC spells some teams with a third letter Sleeper does not use (NEP, KCC,
 * GBP, SFO, TBB, NOS, LVR), so a Sleeper code that is a prefix of KTC's counts.
 */
function sameKtcTeam(ours: string | null, ktcTeam: string): boolean {
  const o = (ours ?? "").toUpperCase();
  if (!o) return false;
  return o === ktcTeam || (o.length === 2 && ktcTeam.startsWith(o));
}

export type KtcMatchResult =
  | { kind: "matched"; playerId: string }
  | { kind: "unmatched" }
  | { kind: "ambiguous"; candidates: string[] };

export type KtcPlayerIndex = {
  resolve(entry: KtcMatchEntry, position: string): KtcMatchResult;
};

export function buildKtcPlayerIndex(players: readonly KtcMatchPlayer[]): KtcPlayerIndex {
  const byKey = new Map<string, KtcMatchPlayer[]>();
  for (const p of players) {
    const key = `${normalizeKtcName(`${p.first_name} ${p.last_name}`)}|${p.position}`;
    const list = byKey.get(key);
    if (list) list.push(p);
    else byKey.set(key, [p]);
  }

  return {
    resolve(entry, position) {
      const key = `${normalizeKtcName(entry.playerName)}|${position}`;
      const candidates = byKey.get(key);
      if (!candidates || candidates.length === 0) return { kind: "unmatched" };
      if (candidates.length === 1) return { kind: "matched", playerId: candidates[0].id };

      const team = entry.team?.toUpperCase() ?? null;
      if (team) {
        const sameTeam = candidates.filter((c) => sameKtcTeam(c.team, team));
        if (sameTeam.length === 1) return { kind: "matched", playerId: sameTeam[0].id };
      }

      const rostered = candidates.filter((c) => !!c.team);
      if (rostered.length === 1) return { kind: "matched", playerId: rostered[0].id };

      const ktcId = String(entry.playerID);
      const owner = candidates.filter((c) => storedKtcId(c.external_ids) === ktcId);
      if (owner.length === 1) return { kind: "matched", playerId: owner[0].id };

      return { kind: "ambiguous", candidates: candidates.map((c) => c.id) };
    },
  };
}

/**
 * One players write per matched player per RUN, not per scrape target.
 *
 * The 1QB and superflex pages carry the same player objects, so writing once
 * per target meant about 1,500 serial single-row UPDATEs, half of them
 * repeats. The pending map reproduces exactly what the old per-target loop
 * left behind: metadata.ktc is the LAST target's object (each target's write
 * overwrote the one before), and the KTC id is the FIRST one seen (each
 * write kept whatever id the row already carried).
 */
export type PendingKtcUpdate<T> = { ktcId: string; raw: T };

export function collectKtcPlayerUpdate<T extends { playerID: number | string }>(
  pending: Map<string, PendingKtcUpdate<T>>,
  playerId: string,
  raw: T,
): void {
  const prev = pending.get(playerId);
  pending.set(playerId, { ktcId: prev?.ktcId ?? String(raw.playerID), raw });
}

type JsonObject = Record<string, unknown>;

/** The three jsonb columns for one player, merged the way the sync always has. */
export function buildKtcPlayerPatch<T>(
  existing: { external_ids: JsonObject; source_synced_at: JsonObject; metadata: JsonObject },
  update: PendingKtcUpdate<T>,
  now: string,
): { external_ids: JsonObject; source_synced_at: JsonObject; metadata: JsonObject } {
  const existingKtcId =
    typeof existing.external_ids.ktc === "string" ? existing.external_ids.ktc : null;
  return {
    external_ids: { ...existing.external_ids, ktc: existingKtcId ?? update.ktcId },
    source_synced_at: { ...existing.source_synced_at, ktc: now },
    metadata: { ...existing.metadata, ktc: update.raw },
  };
}
