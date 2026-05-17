/**
 * KeepTradeCut value sync.
 *
 * Scrapes dynasty + redraft rankings pages (1QB and Superflex), parses the
 * embedded `playersArray` from the HTML, maps to internal players via
 * Sleeper ID lookup OR last-name + position match, and writes
 * player_value_history snapshots for the 5 formats KTC actually publishes.
 *
 * Four formats are scraped directly:
 *   1. dynasty-ppr-std       (Dynasty 1QB PPR)
 *   2. dynasty-ppr-sflex     (Dynasty Superflex PPR)
 *   3. redraft-ppr-std       (Redraft 1QB PPR)
 *   4. redraft-ppr-sflex     (Redraft Superflex PPR)
 *
 * One format is DERIVED from dynasty-ppr-sflex by applying KTC's published
 * TEP+ formula in lib/ktc-tep.ts:
 *   5. dynasty-ppr-tep-sflex (Dynasty Superflex PPR + TEP+)
 *
 * Why derive instead of scrape? KTC explicitly publishes TEP rankings as an
 * algorithmic transformation of the base superflex values — their own site
 * applies the same formula client-side. Hitting the ?tep=1 URL returns the
 * same embedded playersArray as the base sflex URL; the TEP toggle is
 * client-side JS. The community has reverse-engineered the formula (see
 * https://github.com/ees4/KeepTradeCut-Scraper). We reproduce it here so we
 * get correct TEP values that match KTC's own rendered output.
 *
 * DO NOT add ?scoring=half, ?scoring=std, or ?tep=1 to ANY scrape URL. They
 * look like server-side variants but they're NOT — those toggles are
 * client-side JS filters. Hitting those URLs would yield byte-for-byte
 * identical rows in our DB (this is exactly the bug migration 0011 cleaned
 * up). The TEP-sflex pipeline derives algorithmically; for anything else,
 * add a new format_config + supported_format_slugs entry, don't fabricate
 * a query-param scrape.
 *
 * Run: npm run sync:ktc  (then npm run seed:rankings to refresh rankings)
 */

import { getServiceClient } from "./_supabase";
import { applyKtcTep, tepTierFromTePremiumBonus, type TepPlayer } from "../lib/ktc-tep";
import type { Json } from "../lib/database.types";

type KtcPlayer = {
  playerID: number;
  playerName: string;
  position: string;
  team: string | null;
  oneQBValues?: { value?: number; rank?: number; positionalRank?: number; tier?: number };
  superflexValues?: { value?: number; rank?: number; positionalRank?: number; tier?: number };
};

type ScrapeTarget = {
  formatSlug: string;
  url: string;
  variant: "oneQB" | "superflex";
};

// Hard-coded allowed list. Refuse to write rows to any format not on this
// list, even if a stale TARGETS entry slips through. This is the "fail
// closed" backstop against re-introducing the 0011 duplication bug.
const ALLOWED_KTC_FORMAT_SLUGS = new Set<string>([
  "dynasty-ppr-std",
  "dynasty-ppr-sflex",
  "dynasty-ppr-tep-sflex",
  "redraft-ppr-std",
  "redraft-ppr-sflex",
]);

const TARGETS: ScrapeTarget[] = [
  // Dynasty (2 distinct base datasets — TEP-sflex is derived below)
  { formatSlug: "dynasty-ppr-std", url: "https://keeptradecut.com/dynasty-rankings?format=1", variant: "oneQB" },
  { formatSlug: "dynasty-ppr-sflex", url: "https://keeptradecut.com/dynasty-rankings?format=2", variant: "superflex" },
  // Redraft (2 distinct datasets — see header note before adding more)
  { formatSlug: "redraft-ppr-std", url: "https://keeptradecut.com/fantasy-rankings?format=1", variant: "oneQB" },
  { formatSlug: "redraft-ppr-sflex", url: "https://keeptradecut.com/fantasy-rankings?format=2", variant: "superflex" },
];

// Derived formats: (target_format_slug, base_format_slug). After all scrape
// TARGETS land, we apply applyKtcTep() to each derive pair using the base
// format's values and write the result to the target format under
// source='ktc'. The tier is inferred from format_configs.te_premium_bonus.
const DERIVED_FROM_SFLEX: Array<{ targetSlug: string; baseSlug: string }> = [
  { targetSlug: "dynasty-ppr-tep-sflex", baseSlug: "dynasty-ppr-sflex" },
];

// Pairs of (format_a, format_b) that MUST yield distinct datasets when
// scraped. If we ever scrape two URLs that produce byte-for-byte identical
// value vectors for these pairs, throw — that means a query-param assumption
// has silently broken again (like the original 0011 bug).
const MUST_DIFFER_PAIRS: Array<[string, string]> = [
  ["dynasty-ppr-std", "dynasty-ppr-sflex"],
  ["dynasty-ppr-sflex", "redraft-ppr-sflex"],
  ["redraft-ppr-std", "redraft-ppr-sflex"],
  ["dynasty-ppr-std", "redraft-ppr-std"],
];

async function scrapeTarget(target: ScrapeTarget): Promise<KtcPlayer[]> {
  const response = await fetch(target.url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept": "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    console.warn(`  ${target.formatSlug}: HTTP ${response.status}`);
    return [];
  }
  const html = await response.text();
  const match = html.match(/var\s+playersArray\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    console.warn(`  ${target.formatSlug}: no playersArray found`);
    return [];
  }
  try {
    return JSON.parse(match[1]) as KtcPlayer[];
  } catch (err) {
    console.warn(`  ${target.formatSlug}: parse error`, (err as Error).message);
    return [];
  }
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .trim();
}

async function main() {
  const supabase = getServiceClient();

  console.log("Loading format_configs and existing players...");
  const { data: formats, error: formatErr } = await supabase
    .from("format_configs")
    .select("id, slug, te_premium_bonus");
  if (formatErr) throw formatErr;
  if (!formats) throw new Error("missing format data");

  // Page through players (Supabase JS defaults to 1000 rows max)
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
    const { data, error } = await supabase
      .from("players")
      .select("id, external_ids, first_name, last_name, position, team")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    players.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  ${players.length} players loaded`);

  const formatBySlug = new Map(
    formats.map((f) => [f.slug, { id: f.id, te_premium_bonus: Number(f.te_premium_bonus ?? 0) }]),
  );
  const playerByName = new Map<string, string>();
  const positionByPlayerId = new Map<string, string>();
  for (const p of players) {
    const key = `${normalizeName(`${p.first_name} ${p.last_name}`)}|${p.position}`;
    playerByName.set(key, p.id);
    positionByPlayerId.set(p.id, p.position);
  }

  const now = new Date().toISOString();
  let totalRows = 0;
  let unmatched = 0;

  // First pass: scrape all targets and stash rows + value fingerprints. We
  // run the pairwise sanity check before writing anything.
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

  for (const target of TARGETS) {
    // Defense-in-depth: refuse to even scrape a target that isn't on the
    // allow list. Catches refactor mistakes before they hit the network.
    if (!ALLOWED_KTC_FORMAT_SLUGS.has(target.formatSlug)) {
      throw new Error(
        `sync-ktc.ts: refusing to scrape "${target.formatSlug}" — not in ALLOWED_KTC_FORMAT_SLUGS. ` +
          `Update the allow list deliberately and re-verify against KTC.`,
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
      if (!position || position === "PICK") continue;
      const key = `${normalizeName(k.playerName)}|${position}`;
      fingerprint.set(key, value);
      const playerId = playerByName.get(key);
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

  // Defensive pairwise sanity check: throw if two datasets that *must*
  // differ produce identical values for every shared player. That's the
  // exact failure mode that caused the 0011 cleanup, and we never want it
  // to slip back in.
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
        `sync-ktc.ts: ${a} and ${b} returned byte-for-byte identical values ` +
          `for all ${shared} shared players. KTC's URL params likely changed ` +
          `behavior (or didn't actually toggle the dataset). Investigate before writing.`,
      );
    }
  }

  // Derive TEP-adjusted batches from their base sflex batches before we
  // write anything. Each derived batch becomes a brand-new ScrapedBatch and
  // joins the write loop below.
  for (const { targetSlug, baseSlug } of DERIVED_FROM_SFLEX) {
    const targetEntry = formatBySlug.get(targetSlug);
    if (!targetEntry) {
      console.warn(`  ${targetSlug}: no format_config found (skipping derive)`);
      continue;
    }
    const tier = tepTierFromTePremiumBonus(targetEntry.te_premium_bonus);
    if (!tier) {
      console.warn(
        `  ${targetSlug}: te_premium_bonus=${targetEntry.te_premium_bonus} is non-positive; skipping TEP derive`,
      );
      continue;
    }
    const baseBatch = batches.find((b) => b.target.formatSlug === baseSlug);
    if (!baseBatch) {
      console.warn(`  ${targetSlug}: base ${baseSlug} not scraped; skipping derive`);
      continue;
    }

    console.log(`Deriving ${targetSlug} from ${baseSlug} (TEP tier ${tier})...`);
    // Build TEP input keyed by player_id using the player position lookup
    // we built from the players table. KTC's raw position is not stored on
    // batch rows, so we join via positionByPlayerId.
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
      // Derived rows carry a minimal provenance object instead of a real
      // KTC raw payload — these were never scraped, they were computed.
      metadata: {
        derived_from: { source_slug: "ktc", base_format_slug: baseSlug },
        algorithm: "applyKtcTep",
        tep_tier: tier,
      },
    }));

    // Derived batches don't have a separate ktcPlayers list to update player
    // external_ids from — those were already handled by the base scrape.
    batches.push({
      target: {
        formatSlug: targetSlug,
        url: `derived:tep-from:${baseSlug}`,
        variant: "superflex",
      },
      formatId: targetEntry.id,
      rows: derivedRows,
      ktcPlayers: [],
      fingerprint: new Map(
        tepOutput.map((p) => {
          // Reuse the base-batch fingerprint keying scheme (name|position)
          // by re-deriving from positionByPlayerId — not strictly necessary
          // since must-differ pairs don't include derived formats, but kept
          // consistent for any future audit.
          return [p.player_id, p.value];
        }),
      ),
    });
    console.log(`  ${derivedRows.length} TEP-adjusted rows`);
  }

  for (const { target, rows, ktcPlayers } of batches) {

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabase
        .from("player_value_history")
        .upsert(chunk, {
          onConflict: "player_id,format_config_id,source,captured_at",
          ignoreDuplicates: false,
        });
      if (error) {
        console.error("Upsert error:", error.message);
        throw error;
      }
      totalRows += chunk.length;
    }

    // Update KTC IDs, source_synced_at, and metadata on matched players.
    // We need read-modify-write here because the upsert path would clobber
    // sibling source keys in the jsonb maps (CLAUDE.md "Data Architecture
    // Principles" — merge, don't clobber).
    const ktcUpdates = ktcPlayers
      .map((k) => {
        const position = k.position === "RDP" ? "PICK" : k.position?.toUpperCase();
        if (!position || position === "PICK") return null;
        const key = `${normalizeName(k.playerName)}|${position}`;
        const playerId = playerByName.get(key);
        if (!playerId) return null;
        return { playerId, ktcRaw: k };
      })
      .filter(Boolean) as Array<{ playerId: string; ktcRaw: KtcPlayer }>;

    // One bulk SELECT to read existing player rows for merge.
    const updateIds = ktcUpdates.map((u) => u.playerId);
    const existingByPlayerId = new Map<
      string,
      {
        external_ids: Record<string, unknown>;
        source_synced_at: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }
    >();
    for (let from = 0; from < updateIds.length; from += 1000) {
      const batch = updateIds.slice(from, from + 1000);
      const { data, error } = await supabase
        .from("players")
        .select("id, external_ids, source_synced_at, metadata")
        .in("id", batch);
      if (error) throw error;
      for (const p of data ?? []) {
        existingByPlayerId.set(p.id, {
          external_ids: (p.external_ids as Record<string, unknown>) ?? {},
          source_synced_at: (p.source_synced_at as Record<string, unknown>) ?? {},
          metadata: (p.metadata as Record<string, unknown>) ?? {},
        });
      }
    }

    for (const update of ktcUpdates) {
      const existing = existingByPlayerId.get(update.playerId);
      if (!existing) continue;
      const ktcId = String(update.ktcRaw.playerID);
      const existingKtcId =
        typeof existing.external_ids.ktc === "string" ? existing.external_ids.ktc : null;
      const externalIds: Json = {
        ...(existing.external_ids as Record<string, Json>),
        // Only fill ktc id if missing — don't overwrite a manual mapping.
        ktc: existingKtcId ?? ktcId,
      };
      const sourceSyncedAt: Json = {
        ...(existing.source_synced_at as Record<string, Json>),
        ktc: now,
      };
      const metadata: Json = {
        ...(existing.metadata as Record<string, Json>),
        ktc: update.ktcRaw as unknown as Json,
      };
      // Always update source_synced_at + metadata; only update external_ids
      // (effectively a no-op when ktc id was already present).
      const { error } = await supabase
        .from("players")
        .update({
          external_ids: externalIds,
          source_synced_at: sourceSyncedAt,
          metadata,
        })
        .eq("id", update.playerId);
      if (error) {
        console.error("Player merge error:", error.message);
        throw error;
      }
    }
  }

  console.log(`\nDone. Inserted ${totalRows} player_value_history rows. Unmatched KTC players: ${unmatched}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
