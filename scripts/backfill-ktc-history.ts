/**
 * KeepTradeCut historical value backfill.
 *
 * Hits KTC's undocumented "histories" endpoints for both products and
 * decodes the full per-day value history they expose for every ranked
 * player. Idempotent: re-running adds no duplicate rows.
 *
 *   POST https://keeptradecut.com/dynasty-rankings/histories
 *   POST https://keeptradecut.com/fantasy-rankings/histories
 *
 * Body is `'"1"'` (a JSON-encoded "1"). The body is effectively a
 * placeholder, we probed 0/2/7/30/365/null and got identical bytes back,
 * so we send "1" to mirror the public DPC implementation. The endpoints
 * require no auth; KTC just wants a browser-y Referer and User-Agent.
 *
 * Response: array of player objects, each with a per-format section
 * containing four arrays of encoded strings:
 *
 *   { playerID, oneQB:    { valueHistory[], tepHistory[], teppHistory[], tepppHistory[] },
 *                superflex: { ...same shape } }
 *
 * Each encoded string is YYMMDDVVVV+:
 *   - chars 0..1 = year suffix (add 2000)
 *   - chars 2..3 = month (01..12)
 *   - chars 4..5 = day (01..31)
 *   - chars 6..  = integer value
 *
 * Format mapping (FF Beacon native slugs):
 *   dynasty-rankings  oneQB     -> dynasty-ppr-std
 *   dynasty-rankings  superflex -> dynasty-ppr-sflex
 *   dynasty-ppr-tep-sflex      -> DERIVED via lib/ktc-tep applyKtcTep()
 *                                   from each dynasty-ppr-sflex daily snapshot
 *   fantasy-rankings  oneQB     -> redraft-ppr-std
 *   fantasy-rankings  superflex -> redraft-ppr-sflex
 *
 * KTC publishes no TEP arrays for redraft and we don't host a redraft-TEP
 * format_config, so no redraft TEP derivation.
 *
 * captured_at is the historical date at UTC noon (avoids local-tz edge
 * cases when grouping by day). source='ktc'. metadata.ktc_historical
 * preserves the raw entry block per the Data Architecture Principles in
 * CLAUDE.md (one row per (player, format, source, captured_at), so we
 * persist the per-date sliver rather than the entire endpoint blob).
 *
 * Player matching mirrors sync-ktc.ts: name+position lookup against the
 * existing `players` table. Unmatched KTC IDs are logged to
 * /tmp/backfill-ktc-unmatched.json so we don't silently drop rows.
 *
 * Re-runnable: the unique constraint (player_id, format_config_id, source,
 * captured_at) plus ignoreDuplicates:true means a second run is a no-op.
 *
 * Run: npm run backfill:ktc
 *      (or npm run backfill:all to also rebuild player_value_trends after)
 *
 * One-time operation, NOT in the nightly cron. After this runs, the daily
 * sync-ktc.ts script keeps history current going forward.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getServiceClient } from "./_supabase";
import { applyKtcTep, tepTierFromTePremiumBonus, type TepPlayer } from "../lib/ktc-tep";
import type { Json } from "../lib/database.types";

type KtcFormatSection = {
  valueHistory?: unknown;
  tepHistory?: unknown;
  teppHistory?: unknown;
  tepppHistory?: unknown;
};

type KtcPlayerPayload = {
  playerID: number;
  oneQB?: KtcFormatSection;
  superflex?: KtcFormatSection;
};

type DecodedEntry = {
  date: string; // YYYY-MM-DD
  value: number;
  tepValue: number | null;
  teppValue: number | null;
  tepppValue: number | null;
  rawValueEntry: string;
};

type ProductSource = {
  product: "dynasty" | "redraft";
  url: string;
  oneQBSlug: string;
  sflexSlug: string;
};

const PRODUCTS: ProductSource[] = [
  {
    product: "dynasty",
    url: "https://keeptradecut.com/dynasty-rankings/histories",
    oneQBSlug: "dynasty-ppr-std",
    sflexSlug: "dynasty-ppr-sflex",
  },
  {
    product: "redraft",
    url: "https://keeptradecut.com/fantasy-rankings/histories",
    oneQBSlug: "redraft-ppr-std",
    sflexSlug: "redraft-ppr-sflex",
  },
];

// Format slugs whose history is derived from a base slug via applyKtcTep().
// Only dynasty publishes TEP arrays in KTC's response, and our redraft-ppr-tep
// format_config is fed by FantasyCalc, not KTC, so we don't derive redraft
// TEP from redraft sflex here.
const TEP_DERIVE: Array<{ targetSlug: string; baseSlug: string }> = [
  { targetSlug: "dynasty-ppr-tep-sflex", baseSlug: "dynasty-ppr-sflex" },
];

const SOURCE_SLUG = "ktc";
const UNMATCHED_LOG_PATH = join(tmpdir(), "backfill-ktc-unmatched.json");
const UPSERT_BATCH_SIZE = 500;

// Match sync-ktc.ts's name normalization so we get the same player matches
// the daily sync produces. Diverging here would mean backfill rows land
// against different player_ids than current-day rows for the same player.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.''']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .trim();
}

function normalizePosition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "RDP" || upper === "PICK") return null;
  return upper;
}

function decodeOne(entry: unknown): { date: string; value: number; raw: string } | null {
  if (typeof entry !== "string" || entry.length < 7) return null;
  if (!/^\d+$/.test(entry)) return null;
  const yy = parseInt(entry.slice(0, 2), 10);
  const mm = parseInt(entry.slice(2, 4), 10);
  const dd = parseInt(entry.slice(4, 6), 10);
  const value = parseInt(entry.slice(6), 10);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(value)) {
    return null;
  }
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = 2000 + yy;
  const date = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return { date, value, raw: entry };
}

// Merge the four per-format history arrays (value, tep, tepp, teppp) into one
// decoded entry per date. value is the canonical base value; the TEP variants
// are kept verbatim in case a future consumer needs them, but they are NOT
// used for the dynasty-ppr-tep-sflex derivation below (we re-apply our own
// algorithm to base sflex so the result is consistent across all dates).
function buildDecodedEntries(section: KtcFormatSection | undefined): DecodedEntry[] {
  if (!section || typeof section !== "object") return [];

  const byDate = new Map<
    string,
    { value: number | null; tep: number | null; tepp: number | null; teppp: number | null; rawValue: string | null }
  >();

  const assign = (
    arr: unknown,
    field: "value" | "tep" | "tepp" | "teppp",
  ) => {
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      const decoded = decodeOne(raw);
      if (!decoded) continue;
      let acc = byDate.get(decoded.date);
      if (!acc) {
        acc = { value: null, tep: null, tepp: null, teppp: null, rawValue: null };
        byDate.set(decoded.date, acc);
      }
      acc[field] = decoded.value;
      if (field === "value") acc.rawValue = decoded.raw;
    }
  };

  assign(section.valueHistory, "value");
  assign(section.tepHistory, "tep");
  assign(section.teppHistory, "tepp");
  assign(section.tepppHistory, "teppp");

  const out: DecodedEntry[] = [];
  for (const [date, acc] of byDate) {
    if (acc.value === null) continue; // base value is required
    out.push({
      date,
      value: acc.value,
      tepValue: acc.tep,
      teppValue: acc.tepp,
      tepppValue: acc.teppp,
      rawValueEntry: acc.rawValue ?? "",
    });
  }
  return out;
}

async function fetchHistories(url: string): Promise<KtcPlayerPayload[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      referer: "https://keeptradecut.com/",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
    body: '"1"',
  });
  if (!res.ok) {
    throw new Error(`KTC histories ${res.status} ${res.statusText} for ${url}`);
  }
  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error(`KTC histories returned non-array (${typeof json}) for ${url}`);
  }
  return json as KtcPlayerPayload[];
}

// captured_at must be a single canonical timestamp for a (player, format,
// source, date) tuple so re-runs hit the same row via the unique constraint.
// UTC noon avoids local-tz off-by-one and keeps "calendar day" semantics.
function dateToTimestamp(dateYmd: string): string {
  return `${dateYmd}T12:00:00.000Z`;
}

type HistoryRowInsert = {
  player_id: string;
  format_config_id: string;
  value: number;
  source: string;
  captured_at: string;
  metadata: Json;
};

type ProductSnapshots = {
  product: "dynasty" | "redraft";
  // playerID -> { sflexByDate: Map<dateYmd, value>, oneQBByDate: Map<dateYmd, value> }
  perPlayer: Map<
    number,
    {
      sflex: DecodedEntry[];
      oneQB: DecodedEntry[];
    }
  >;
  unmatched: Array<{ ktcPlayerID: number }>;
};

async function main() {
  const supabase = getServiceClient();

  // --- Load format_configs (with te_premium_bonus for TEP tier mapping)
  const { data: formats, error: formatErr } = await supabase
    .from("format_configs")
    .select("id, slug, te_premium_bonus");
  if (formatErr) throw formatErr;
  if (!formats) throw new Error("Missing format_configs");
  const formatBySlug = new Map(
    formats.map((f) => [f.slug, { id: f.id, te_premium_bonus: Number(f.te_premium_bonus ?? 0) }]),
  );

  // --- Load players. Paginated to bypass the 1000-row PostgREST default.
  type PlayerRow = {
    id: string;
    external_ids: unknown;
    first_name: string;
    last_name: string;
    position: string;
    team: string | null;
  };
  const players: PlayerRow[] = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("players")
      .select("id, external_ids, first_name, last_name, position, team")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    players.push(...(data as PlayerRow[]));
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`Loaded ${players.length} players, ${formats.length} format_configs`);

  // KTC players don't carry sleeperId, so name|position is the only matching
  // surface, same as sync-ktc.ts. Build the lookup once.
  const playerByName = new Map<string, string>();
  const positionByPlayerId = new Map<string, string>();
  for (const p of players) {
    const key = `${normalizeName(`${p.first_name} ${p.last_name}`)}|${p.position}`;
    playerByName.set(key, p.id);
    positionByPlayerId.set(p.id, p.position);
  }

  // To resolve a KTC playerID to one of our player_ids we need each KTC
  // player's name + position. The histories endpoint only returns the
  // encoded value history, no name. We pull names from the public
  // dynasty-rankings + fantasy-rankings HTML pages (same `playersArray`
  // embedded script the daily sync uses).
  const ktcMetaByID = new Map<number, { name: string; position: string }>();
  for (const rankingsUrl of [
    "https://keeptradecut.com/dynasty-rankings?format=2",
    "https://keeptradecut.com/fantasy-rankings?format=2",
  ]) {
    const meta = await fetchKtcPlayerMeta(rankingsUrl);
    for (const [id, info] of meta) {
      // Dynasty page wins ties (loaded first). Either source's name+position
      // is fine, KTC keys players consistently across products.
      if (!ktcMetaByID.has(id)) ktcMetaByID.set(id, info);
    }
  }
  console.log(`Loaded ${ktcMetaByID.size} KTC player metadata entries`);

  // --- Fetch + decode each product
  const productSnapshots: ProductSnapshots[] = [];
  for (const product of PRODUCTS) {
    console.log(`Fetching ${product.product} histories...`);
    const players = await fetchHistories(product.url);
    console.log(`  ${players.length} ${product.product} players`);

    const perPlayer = new Map<number, { sflex: DecodedEntry[]; oneQB: DecodedEntry[] }>();
    const unmatched: Array<{ ktcPlayerID: number }> = [];
    for (const p of players) {
      if (typeof p?.playerID !== "number") continue;
      const meta = ktcMetaByID.get(p.playerID);
      if (!meta) {
        unmatched.push({ ktcPlayerID: p.playerID });
        continue;
      }
      perPlayer.set(p.playerID, {
        sflex: buildDecodedEntries(p.superflex),
        oneQB: buildDecodedEntries(p.oneQB),
      });
    }
    productSnapshots.push({ product: product.product, perPlayer, unmatched });
  }

  // --- Build history rows for the four base format slugs
  const allRows: HistoryRowInsert[] = [];
  const unmatchedToPlayerByName: Array<{ ktcPlayerID: number; name: string; position: string; product: string }> = [];
  const unmatchedToKtcMeta: Array<{ ktcPlayerID: number; product: string }> = [];

  // Track decoded sflex history per player_id+date+product for TEP derivation.
  // Key: `${product}::${playerId}::${date}` -> value
  // Plus a separate map of player_id -> position so applyKtcTep gets the right
  // role per row (TE vs non-TE).
  const sflexByProductPlayerDate = new Map<string, number>();

  for (const prodSnap of productSnapshots) {
    const product = PRODUCTS.find((p) => p.product === prodSnap.product)!;
    const oneQBFormat = formatBySlug.get(product.oneQBSlug);
    const sflexFormat = formatBySlug.get(product.sflexSlug);
    if (!oneQBFormat || !sflexFormat) {
      console.warn(
        `  ${product.product}: missing format_config (oneQB=${product.oneQBSlug}, sflex=${product.sflexSlug}); skipping`,
      );
      continue;
    }

    let matched = 0;
    let unmatched = 0;
    for (const [ktcPlayerID, snaps] of prodSnap.perPlayer) {
      const meta = ktcMetaByID.get(ktcPlayerID)!;
      const position = normalizePosition(meta.position);
      if (!position) continue;
      const nameKey = `${normalizeName(meta.name)}|${position}`;
      const playerId = playerByName.get(nameKey);
      if (!playerId) {
        unmatchedToPlayerByName.push({
          ktcPlayerID,
          name: meta.name,
          position,
          product: product.product,
        });
        unmatched += 1;
        continue;
      }
      matched += 1;

      const pushRows = (
        entries: DecodedEntry[],
        formatId: string,
        formatSlug: string,
        variant: "oneQB" | "superflex",
      ) => {
        for (const e of entries) {
          allRows.push({
            player_id: playerId,
            format_config_id: formatId,
            value: e.value,
            source: SOURCE_SLUG,
            captured_at: dateToTimestamp(e.date),
            metadata: {
              ktc_historical: {
                ktc_player_id: ktcPlayerID,
                product: product.product,
                format_slug: formatSlug,
                variant,
                date: e.date,
                value: e.value,
                tep_value: e.tepValue,
                tepp_value: e.teppValue,
                teppp_value: e.tepppValue,
                raw_entry: e.rawValueEntry,
              },
            } as unknown as Json,
          });
          if (variant === "superflex") {
            sflexByProductPlayerDate.set(`${product.product}::${playerId}::${e.date}`, e.value);
          }
        }
      };

      pushRows(snaps.oneQB, oneQBFormat.id, product.oneQBSlug, "oneQB");
      pushRows(snaps.sflex, sflexFormat.id, product.sflexSlug, "superflex");
    }

    for (const u of prodSnap.unmatched) {
      unmatchedToKtcMeta.push({ ktcPlayerID: u.ktcPlayerID, product: product.product });
    }
    console.log(
      `  ${product.product}: matched=${matched}, unmatched_to_player_table=${unmatched}, unmatched_to_ktc_meta=${prodSnap.unmatched.length}`,
    );
  }

  // --- TEP derivation: each (date, dynasty-ppr-sflex) snapshot -> dynasty-ppr-tep-sflex
  for (const { targetSlug, baseSlug } of TEP_DERIVE) {
    const targetFormat = formatBySlug.get(targetSlug);
    const baseFormat = formatBySlug.get(baseSlug);
    if (!targetFormat || !baseFormat) {
      console.warn(`  TEP derive: missing format_config (target=${targetSlug}, base=${baseSlug}); skipping`);
      continue;
    }
    const tier = tepTierFromTePremiumBonus(targetFormat.te_premium_bonus);
    if (!tier) {
      console.warn(
        `  TEP derive: te_premium_bonus=${targetFormat.te_premium_bonus} non-positive for ${targetSlug}; skipping`,
      );
      continue;
    }

    // Bucket base sflex rows by date so applyKtcTep operates on the full
    // per-date dataset (TE re-ranking depends on all values that day).
    // Dynasty product only, TEP_DERIVE is hard-coded to dynasty base.
    const dynastyProduct = "dynasty";
    const rowsByDate = new Map<string, Array<{ player_id: string; position: string; value: number }>>();
    for (const [key, value] of sflexByProductPlayerDate) {
      const [product, playerId, date] = key.split("::");
      if (product !== dynastyProduct) continue;
      const position = positionByPlayerId.get(playerId) ?? "WR";
      let bucket = rowsByDate.get(date);
      if (!bucket) {
        bucket = [];
        rowsByDate.set(date, bucket);
      }
      bucket.push({ player_id: playerId, position, value });
    }

    console.log(`Deriving ${targetSlug} from ${baseSlug} for ${rowsByDate.size} dates (TEP tier ${tier})...`);
    let derivedCount = 0;
    let skippedSmallDates = 0;
    for (const [date, bucket] of rowsByDate) {
      // applyKtcTep guards against datasets <=25 rows. Early-day snapshots
      // can be thinner than the live page if KTC was rolling out coverage,
      // so we skip rather than throw.
      if (bucket.length <= 25) {
        skippedSmallDates += 1;
        continue;
      }
      const input: TepPlayer[] = bucket.map((b) => ({
        player_id: b.player_id,
        position: b.position,
        value: b.value,
      }));
      const output = applyKtcTep(input, tier);
      for (const p of output) {
        allRows.push({
          player_id: p.player_id,
          format_config_id: targetFormat.id,
          value: p.value,
          source: SOURCE_SLUG,
          captured_at: dateToTimestamp(date),
          metadata: {
            derived_from: { source_slug: SOURCE_SLUG, base_format_slug: baseSlug },
            algorithm: "applyKtcTep",
            tep_tier: tier,
            date,
          } as unknown as Json,
        });
        derivedCount += 1;
      }
    }
    console.log(
      `  ${targetSlug}: ${derivedCount} derived rows across ${rowsByDate.size - skippedSmallDates} dates (${skippedSmallDates} dates skipped as <=25 players)`,
    );
  }

  // --- Write phase (idempotent via unique constraint)
  console.log(`\nUpserting ${allRows.length} player_value_history rows...`);
  let upserted = 0;
  for (let i = 0; i < allRows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = allRows.slice(i, i + UPSERT_BATCH_SIZE);
    // Wrap the upsert in retry/backoff. Supabase's edge proxies occasionally
    // close the socket mid-stream on long runs (observed at ~120K rows during
    // the first backfill). The unique constraint + ignoreDuplicates means a
    // replay of the same chunk is safe, already-inserted rows are no-ops.
    await upsertWithRetry(supabase, chunk);
    upserted += chunk.length;
    if (i % (UPSERT_BATCH_SIZE * 10) === 0 && i > 0) {
      console.log(`  progress: ${upserted}/${allRows.length}`);
    }
  }

  // --- Unmatched log
  writeFileSync(
    UNMATCHED_LOG_PATH,
    JSON.stringify(
      {
        unmatched_to_player_table: unmatchedToPlayerByName,
        unmatched_to_ktc_meta: unmatchedToKtcMeta,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(
    `\nDone. Inserted/skipped-duplicate ${upserted} rows total. ` +
      `Unmatched (to player table): ${unmatchedToPlayerByName.length}. ` +
      `Unmatched (KTC IDs without metadata on rankings page): ${unmatchedToKtcMeta.length}. ` +
      `Detail at ${UNMATCHED_LOG_PATH}.`,
  );
}

// Upsert a chunk into player_value_history with bounded retry on transient
// network errors. Supabase's edge proxies sometimes close the socket
// mid-request on long-running runs ("UND_ERR_SOCKET other side closed"),
// which is harmless if we retry, the unique constraint guarantees that a
// replayed batch produces no duplicate rows. We give up after 5 attempts so
// a genuinely broken endpoint doesn't loop forever.
async function upsertWithRetry(
  supabase: ReturnType<typeof getServiceClient>,
  chunk: HistoryRowInsert[],
): Promise<void> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { error } = await supabase
      .from("player_value_history")
      .upsert(chunk, {
        onConflict: "player_id,format_config_id,source,captured_at",
        ignoreDuplicates: true,
      });
    if (!error) return;
    const transient =
      /fetch failed|socket|ETIMEDOUT|ECONNRESET|UND_ERR_SOCKET|other side closed/i.test(
        `${error.message} ${(error as { details?: string }).details ?? ""}`,
      );
    if (!transient || attempt === MAX_ATTEMPTS) {
      console.error("Upsert error:", error.message);
      throw error;
    }
    const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
    console.warn(
      `  upsert attempt ${attempt} failed (${error.message}); retrying in ${backoffMs}ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
}

// Pull KTC's `playersArray` JSON from a rankings page so we can map
// playerID -> { name, position }. The histories endpoint omits names. The
// daily sync also reads this same embedded array (sync-ktc.ts), but we
// re-parse here because the daily sync isn't guaranteed to run before
// backfill and we don't want a stale ktc_player_id mapping.
async function fetchKtcPlayerMeta(
  url: string,
): Promise<Map<number, { name: string; position: string }>> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    throw new Error(`KTC rankings ${res.status} ${res.statusText} for ${url}`);
  }
  const html = await res.text();
  const m = html.match(/var\s+playersArray\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) throw new Error(`No playersArray found at ${url}`);
  let arr: unknown;
  try {
    arr = JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`Failed to parse playersArray at ${url}: ${(err as Error).message}`);
  }
  if (!Array.isArray(arr)) throw new Error(`playersArray is not an array at ${url}`);
  const out = new Map<number, { name: string; position: string }>();
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const id = typeof p.playerID === "number" ? p.playerID : null;
    if (id == null) continue;
    const name = typeof p.playerName === "string" ? p.playerName.trim() : "";
    const position = typeof p.position === "string" ? p.position.trim() : "";
    if (!name || !position) continue;
    out.set(id, { name, position });
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
