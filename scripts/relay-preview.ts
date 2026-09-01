/**
 * scripts/relay-preview.ts
 *
 * CLI: build League Relay writeups for a league WITHOUT posting anything.
 *
 * The same builders, the same renderer and the same Discord limits the live
 * path uses. It claims nothing, sends nothing, and ignores both the watermark
 * and the enable flags, so a writeup can be read before any of it is switched
 * on. This is the thing to run before pointing the relay at a real channel.
 *
 * Usage:
 *   npm run relay:preview -- <sleeper_league_id>
 *   npm run relay:preview -- <sleeper_league_id> --types=trade,matchup_recap
 *   npm run relay:preview -- <sleeper_league_id> --per-type=3 --snark=0.9
 *   npm run relay:preview -- --list
 */

import { getServiceClient } from "./_supabase";
import { previewRelayMessages } from "../lib/league-relay/preview";
import {
  DEFAULT_LEAGUE_RELAY_SETTINGS,
  RELAY_MESSAGE_TYPES,
  type RelayMessageType,
} from "../lib/league-relay/default-settings";

function flag(args: string[], name: string): string | null {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const supabase = getServiceClient();

  if (args.includes("--list")) {
    const { data } = await supabase
      .from("leagues")
      .select("sleeper_league_id, name, season, total_rosters, last_pulsed_at")
      .order("last_pulsed_at", { ascending: false, nullsFirst: false })
      .limit(30);
    console.log("Synced leagues, most recently pulsed first:\n");
    for (const l of data ?? []) {
      console.log(
        `  ${l.sleeper_league_id}  ${l.season}  ${String(l.total_rosters ?? "?").padStart(2)} teams  ${l.name}`,
      );
    }
    return;
  }

  const sleeperLeagueId = args.find((a) => !a.startsWith("--"));
  if (!sleeperLeagueId) {
    console.error(
      "Usage: npm run relay:preview -- <sleeper_league_id> [--types=trade,waiver,matchup_preview,matchup_recap] [--per-type=N] [--snark=0..1]",
    );
    console.error("       npm run relay:preview -- --list");
    process.exit(1);
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) {
    console.error(
      `No league with sleeper_league_id=${sleeperLeagueId} is synced. Run: npm run pulse:league -- ${sleeperLeagueId}`,
    );
    process.exit(1);
  }

  const typesArg = flag(args, "types");
  const types = (
    typesArg
      ? typesArg
          .split(",")
          .map((t) => t.trim())
          .filter((t): t is RelayMessageType =>
            (RELAY_MESSAGE_TYPES as readonly string[]).includes(t),
          )
      : RELAY_MESSAGE_TYPES
  ) as RelayMessageType[];

  const perType = Number(flag(args, "per-type") ?? 1);
  const snarkArg = flag(args, "snark");
  const settings = snarkArg
    ? {
        ...DEFAULT_LEAGUE_RELAY_SETTINGS,
        voice: { ...DEFAULT_LEAGUE_RELAY_SETTINGS.voice, snark: Number(snarkArg) },
      }
    : undefined;

  console.log(`\n=== League Relay preview: ${league.name} (${sleeperLeagueId}) ===\n`);

  const result = await previewRelayMessages(supabase, {
    leagueRowId: league.id,
    types,
    perType: Number.isFinite(perType) ? perType : 1,
    settings,
  });

  for (const note of result.notes) console.log(`[note] ${note}`);
  if (result.notes.length > 0) console.log("");

  for (const message of result.messages) {
    console.log("-".repeat(78));
    console.log(`TYPE: ${message.type}`);
    console.log(`KEY:  ${message.dedupeKey}`);
    console.log(`WHY:  ${message.note}`);
    console.log("-".repeat(78));
    console.log(message.text);
    console.log("");
  }

  console.log(
    `${result.messages.length} message${result.messages.length === 1 ? "" : "s"} built. Nothing was posted.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
