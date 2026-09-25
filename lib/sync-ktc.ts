/**
 * KeepTradeCut value sync (library form).
 *
 * Extracted from scripts/sync-ktc.ts so both the CLI script (`npm run sync:ktc`)
 * and the Vercel cron endpoint (`/api/cron/sync-ktc`) call the same code path.
 * See the script's header for the full pipeline description, including TEP
 * derivation, MUST_DIFFER_PAIRS canaries, and the 0011 footgun history.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyKtcTep, tepTierFromTePremiumBonus, type TepPlayer } from "./ktc-tep";
import { parsePickName } from "./ktc-picks";
import { extractKtcPlayers } from "./ktc-page";
import { withRetry } from "./supabase/retry";
import {
  buildKtcPlayerIndex,
  buildKtcPlayerPatch,
  collectKtcPlayerUpdate,
  normalizeKtcName,
  type PendingKtcUpdate,
} from "./ktc-player-match";
import type { Database, Json } from "./database.types";

/** players writes in flight at once after the scrape (one per matched player). */
const PLAYER_WRITE_CONCURRENCY = 8;

const PICK_FORMAT_SLUGS = new Set<string>(["dynasty-ppr-std", "dynasty-ppr-sflex"]);

type PickRow = {
  season: number;
  round: number;
  pick_position: "early" | "mid" | "late";
  format_config_id: string;
  source: string;
  value: number;
  captured_at: string;
  metadata: Json;
};

type KtcPlayer = {
  playerID: number;
  playerName: string;
  position: string;
  team: string | null;
  // `tier` was replaced by overallTier / positionalTier in KTC's 2026-09 page.
  // Nothing here reads either; the whole object is kept in metadata as sent.
  oneQBValues?: { value?: number; rank?: number; positionalRank?: number; tier?: number; overallTier?: number; positionalTier?: number };
  superflexValues?: { value?: number; rank?: number; positionalRank?: number; tier?: number; overallTier?: number; positionalTier?: number };
};

type ScrapeTarget = {
  formatSlug: string;
  url: string;
  variant: "oneQB" | "superflex";
};

const ALLOWED_KTC_FORMAT_SLUGS = new Set<string>([
  "dynasty-ppr-std",
  "dynasty-ppr-sflex",
  "dynasty-ppr-tep-sflex",
  "redraft-ppr-std",
  "redraft-ppr-sflex",
]);

const TARGETS: ScrapeTarget[] = [
  { formatSlug: "dynasty-ppr-std", url: "https://keeptradecut.com/dynasty-rankings?format=1", variant: "oneQB" },
  { formatSlug: "dynasty-ppr-sflex", url: "https://keeptradecut.com/dynasty-rankings?format=2", variant: "superflex" },
  { formatSlug: "redraft-ppr-std", url: "https://keeptradecut.com/fantasy-rankings?format=1", variant: "oneQB" },
  { formatSlug: "redraft-ppr-sflex", url: "https://keeptradecut.com/fantasy-rankings?format=2", variant: "superflex" },
];

const DERIVED_FROM_SFLEX: Array<{ targetSlug: string; baseSlug: string }> = [
  { targetSlug: "dynasty-ppr-tep-sflex", baseSlug: "dynasty-ppr-sflex" },
];

const MUST_DIFFER_PAIRS: Array<[string, string]> = [
  ["dynasty-ppr-std", "dynasty-ppr-sflex"],
  ["dynasty-ppr-sflex", "redraft-ppr-sflex"],
  ["redraft-ppr-std", "redraft-ppr-sflex"],
  ["dynasty-ppr-std", "redraft-ppr-std"],
];

export type KtcSyncResult = {
  ok: boolean;
  totalValueRows: number;
  totalPickRows: number;
  unmatched: number;
  perFormat: Array<{ formatSlug: string; rows: number }>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

async function scrapeTarget(target: ScrapeTarget): Promise<KtcPlayer[]> {
  const response = await fetch(target.url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    console.warn(`  ${target.formatSlug}: HTTP ${response.status}`);
    return [];
  }
  const html = await response.text();
  // lib/ktc-page.ts reads both page layouts KTC has served (see its header).
  const extracted = extractKtcPlayers(html);
  if (!extracted) {
    console.warn(
      `  ${target.formatSlug}: HTTP 200 but no player list in the page (${html.length} bytes); KTC's markup may have changed again`,
    );
    return [];
  }
  if (extracted.players.length === 0) {
    // A list that parses but is empty is the next silent failure waiting to
    // happen: say so rather than skip the target without a word.
    console.warn(`  ${target.formatSlug}: the page's player list is present but empty (${extracted.layout})`);
  }
  return extracted.players as KtcPlayer[];
}

const normalizeName = normalizeKtcName;

export async function runKtcSync(
  supabase: SupabaseClient<Database>,
): Promise<KtcSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  console.log("Loading format_configs and existing players...");
  const formats = await withRetry(
    async () => {
      const { data, error } = await supabase
        .from("format_configs")
        .select("id, slug, te_premium_bonus");
      if (error) throw error;
      if (!data) throw new Error("missing format data");
      return data;
    },
    { label: "format_configs select" },
  );

  const players: Array<{
    id: string;
    external_ids: unknown;
    first_name: string;
    last_name: string;
    position: string;
    team: string | null;
  }> = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const pageOffset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, external_ids, first_name, last_name, position, team")
          .order("id", { ascending: true })
          .range(pageOffset, pageOffset + PAGE_SIZE - 1);
        if (error) throw error;
        return data ?? [];
      },
      { label: `players select page ${from}` },
    );
    if (page.length === 0) break;
    players.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  console.log(`  ${players.length} players loaded`);

  const formatBySlug = new Map(
    formats.map((f) => [f.slug, { id: f.id, te_premium_bonus: Number(f.te_premium_bonus ?? 0) }]),
  );
  // Two rows can share a name and position (Frank Gore and Frank Gore Jr.);
  // the index decides between them instead of letting the last row win.
  const playerIndex = buildKtcPlayerIndex(players);
  const ambiguousWarned = new Set<string>();
  const resolvePlayerId = (k: KtcPlayer, position: string): string | null => {
    const r = playerIndex.resolve(k, position);
    if (r.kind === "matched") return r.playerId;
    if (r.kind === "ambiguous" && !ambiguousWarned.has(k.playerName)) {
      ambiguousWarned.add(k.playerName);
      console.warn(
        `  ktc ambiguous name: "${k.playerName}" (${position}, ktc=${k.playerID}) matches ${r.candidates.length} players; skipped`,
      );
    }
    return null;
  };
  const positionByPlayerId = new Map<string, string>();
  for (const p of players) {
    positionByPlayerId.set(p.id, p.position);
  }

  const now = new Date().toISOString();
  let totalRows = 0;
  let unmatched = 0;

  type ScrapedBatch = {
    target: ScrapeTarget;
    formatId: string;
    rows: Array<{
      player_id: string;
      format_config_id: string;
      value: number;
      source: string;
      captured_at: string;
      metadata: Json;
    }>;
    ktcPlayers: KtcPlayer[];
    fingerprint: Map<string, number>;
  };

  const batches: ScrapedBatch[] = [];
  const pickRows: PickRow[] = [];

  for (const target of TARGETS) {
    if (!ALLOWED_KTC_FORMAT_SLUGS.has(target.formatSlug)) {
      throw new Error(
        `runKtcSync: refusing to scrape "${target.formatSlug}", not in ALLOWED_KTC_FORMAT_SLUGS.`,
      );
    }
    const formatEntry = formatBySlug.get(target.formatSlug);
    if (!formatEntry) {
      console.warn(`  ${target.formatSlug}: no format_config found`);
      continue;
    }
    const formatId = formatEntry.id;
    console.log(`Scraping ${target.formatSlug}...`);
    const ktcPlayers = await scrapeTarget(target);
    if (ktcPlayers.length === 0) continue;
    console.log(`  ${ktcPlayers.length} KTC entries`);

    const rows: ScrapedBatch["rows"] = [];
    const fingerprint = new Map<string, number>();

    for (const k of ktcPlayers) {
      const valueBlock = target.variant === "superflex" ? k.superflexValues : k.oneQBValues;
      const value = valueBlock?.value;
      if (typeof value !== "number") continue;
      const position = k.position === "RDP" ? "PICK" : k.position?.toUpperCase();
      if (!position) continue;

      if (position === "PICK") {
        if (!PICK_FORMAT_SLUGS.has(target.formatSlug)) continue;
        const parsed = parsePickName(k.playerName);
        if (!parsed) continue;
        pickRows.push({
          season: parsed.season,
          round: parsed.round,
          pick_position:
            parsed.pick_position === "unknown" ? "mid" : parsed.pick_position,
          format_config_id: formatId,
          source: "ktc",
          value,
          captured_at: now,
          metadata: k as unknown as Json,
        });
        continue;
      }

      const key = `${normalizeName(k.playerName)}|${position}`;
      fingerprint.set(key, value);
      const playerId = resolvePlayerId(k, position);
      if (!playerId) {
        unmatched++;
        continue;
      }
      rows.push({
        player_id: playerId,
        format_config_id: formatId,
        value,
        source: "ktc",
        captured_at: now,
        metadata: k as unknown as Json,
      });
    }

    if (rows.length === 0) continue;
    batches.push({ target, formatId, rows, ktcPlayers, fingerprint });
  }

  const byFormat = new Map(batches.map((b) => [b.target.formatSlug, b.fingerprint]));
  for (const [a, b] of MUST_DIFFER_PAIRS) {
    const fa = byFormat.get(a);
    const fb = byFormat.get(b);
    if (!fa || !fb) continue;
    let shared = 0;
    let identical = 0;
    for (const [key, va] of fa) {
      const vb = fb.get(key);
      if (typeof vb !== "number") continue;
      shared++;
      if (va === vb) identical++;
    }
    if (shared > 0 && identical === shared) {
      throw new Error(
        `runKtcSync: ${a} and ${b} returned byte-for-byte identical values for ${shared} shared players.`,
      );
    }
  }

  for (const { targetSlug, baseSlug } of DERIVED_FROM_SFLEX) {
    const targetEntry = formatBySlug.get(targetSlug);
    if (!targetEntry) {
      console.warn(`  ${targetSlug}: no format_config found (skipping derive)`);
      continue;
    }
    const tier = tepTierFromTePremiumBonus(targetEntry.te_premium_bonus);
    if (!tier) {
      console.warn(
        `  ${targetSlug}: te_premium_bonus=${targetEntry.te_premium_bonus} non-positive; skipping TEP derive`,
      );
      continue;
    }
    const baseBatch = batches.find((b) => b.target.formatSlug === baseSlug);
    if (!baseBatch) {
      console.warn(`  ${targetSlug}: base ${baseSlug} not scraped; skipping derive`);
      continue;
    }

    console.log(`Deriving ${targetSlug} from ${baseSlug} (TEP tier ${tier})...`);
    const tepInput: TepPlayer[] = baseBatch.rows.map((r) => ({
      player_id: r.player_id,
      position: positionByPlayerId.get(r.player_id) ?? "WR",
      value: r.value,
    }));
    const tepOutput = applyKtcTep(tepInput, tier);
    const derivedRows: ScrapedBatch["rows"] = tepOutput.map((p) => ({
      player_id: p.player_id,
      format_config_id: targetEntry.id,
      value: p.value,
      source: "ktc",
      captured_at: now,
      metadata: {
        derived_from: { source_slug: "ktc", base_format_slug: baseSlug },
        algorithm: "applyKtcTep",
        tep_tier: tier,
      },
    }));

    batches.push({
      target: { formatSlug: targetSlug, url: `derived:tep-from:${baseSlug}`, variant: "superflex" },
      formatId: targetEntry.id,
      rows: derivedRows,
      ktcPlayers: [],
      fingerprint: new Map(tepOutput.map((p) => [p.player_id, p.value])),
    });
    console.log(`  ${derivedRows.length} TEP-adjusted rows`);
  }

  const perFormat: Array<{ formatSlug: string; rows: number }> = [];
  const pendingPlayerUpdates = new Map<string, PendingKtcUpdate<KtcPlayer>>();

  for (const { target, rows, ktcPlayers } of batches) {
    let formatRows = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("player_value_history")
            .upsert(chunk, {
              onConflict: "player_id,format_config_id,source,captured_at",
              ignoreDuplicates: false,
            });
          if (error) throw error;
        },
        { label: `player_value_history upsert ${target.formatSlug}` },
      );
      totalRows += chunk.length;
      formatRows += chunk.length;
    }
    perFormat.push({ formatSlug: target.formatSlug, rows: formatRows });

    for (const k of ktcPlayers) {
      const position = k.position === "RDP" ? "PICK" : k.position?.toUpperCase();
      if (!position || position === "PICK") continue;
      const playerId = resolvePlayerId(k, position);
      if (!playerId) continue;
      collectKtcPlayerUpdate(pendingPlayerUpdates, playerId, k);
    }
  }

  // One write per matched player for the whole run (see collectKtcPlayerUpdate).
  const updateIds = [...pendingPlayerUpdates.keys()];
  const existingByPlayerId = new Map<
    string,
    {
      external_ids: Record<string, unknown>;
      source_synced_at: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }
  >();
  for (let from = 0; from < updateIds.length; from += 200) {
    const batch = updateIds.slice(from, from + 200);
    const data = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, external_ids, source_synced_at, metadata")
          .in("id", batch);
        if (error) throw error;
        return data ?? [];
      },
      { label: `players select for merge` },
    );
    for (const p of data) {
      existingByPlayerId.set(p.id, {
        external_ids: (p.external_ids as Record<string, unknown>) ?? {},
        source_synced_at: (p.source_synced_at as Record<string, unknown>) ?? {},
        metadata: (p.metadata as Record<string, unknown>) ?? {},
      });
    }
  }

  const writePlayer = async (playerId: string): Promise<void> => {
    const update = pendingPlayerUpdates.get(playerId);
    const existing = existingByPlayerId.get(playerId);
    if (!update || !existing) return;
    const patch = buildKtcPlayerPatch(existing, update, now);
    const externalIds = patch.external_ids as Json;
    const sourceSyncedAt = patch.source_synced_at as Json;
    const metadata = patch.metadata as Json;
    try {
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("players")
            .update({
              external_ids: externalIds,
              source_synced_at: sourceSyncedAt,
              metadata,
            })
            .eq("id", playerId);
          if (error) throw error;
        },
        { label: `players update ${playerId.slice(0, 8)}` },
      );
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code;
      if (code !== "23505") throw err;
      console.warn(
        `  ktc id collision: another player already owns ktc=${update.ktcId}; updating source_synced_at + metadata only`,
      );
      await withRetry(
        async () => {
          const { error: retryErr } = await supabase
            .from("players")
            .update({ source_synced_at: sourceSyncedAt, metadata })
            .eq("id", playerId);
          if (retryErr) throw retryErr;
        },
        { label: `players update (no ktc) ${playerId.slice(0, 8)}` },
      );
    }
  };
  let nextWrite = 0;
  const writeWorker = async (): Promise<void> => {
    for (;;) {
      const i = nextWrite++;
      if (i >= updateIds.length) return;
      await writePlayer(updateIds[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PLAYER_WRITE_CONCURRENCY, updateIds.length) }, () => writeWorker()),
  );
  console.log(`  ${updateIds.length} players rows updated with KTC metadata`);

  for (const { targetSlug, baseSlug } of DERIVED_FROM_SFLEX) {
    if (!PICK_FORMAT_SLUGS.has(baseSlug)) continue;
    const targetEntry = formatBySlug.get(targetSlug);
    if (!targetEntry) continue;
    const baseFormatId = formatBySlug.get(baseSlug)?.id;
    if (!baseFormatId) continue;
    const basePicks = pickRows.filter((p) => p.format_config_id === baseFormatId);
    for (const p of basePicks) {
      pickRows.push({
        ...p,
        format_config_id: targetEntry.id,
        metadata: {
          derived_from: { source_slug: "ktc", base_format_slug: baseSlug },
          algorithm: "copy",
          original: p.metadata,
        },
      });
    }
  }

  let picksWritten = 0;
  if (pickRows.length > 0) {
    console.log(`\nWriting ${pickRows.length} draft_pick_values rows...`);
    for (let i = 0; i < pickRows.length; i += 200) {
      const chunk = pickRows.slice(i, i + 200);
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("draft_pick_values")
            .upsert(chunk, {
              onConflict: "season,round,pick_position,format_config_id,source,captured_at",
              ignoreDuplicates: false,
            });
          if (error) throw error;
        },
        { label: "draft_pick_values upsert" },
      );
      picksWritten += chunk.length;
    }
  }

  // A run that writes nothing is a failure, not a quiet success. Every target
  // returning empty means KTC's markup changed or the scrape was blocked, and
  // we want the cron to surface a 500 so the outage is visible rather than
  // logging a green "ok" with no data behind it.
  if (totalRows === 0) {
    throw new Error(
      "runKtcSync: wrote 0 player_value_history rows, every KTC target returned empty (source markup may have changed or the scrape was blocked).",
    );
  }

  const finished = Date.now();
  console.log(
    `\nDone. Inserted ${totalRows} player_value_history rows and ${picksWritten} draft_pick_values rows. Unmatched: ${unmatched}`,
  );

  return {
    ok: true,
    totalValueRows: totalRows,
    totalPickRows: picksWritten,
    unmatched,
    perFormat,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
