import { fetchKtcPlayers } from "../lib/ktc-fetch";

async function main() {
  const extracted = await fetchKtcPlayers("dynasty");
  const players = extracted.players as Array<Record<string, unknown>>;
  console.log("Source:", extracted.source);
  console.log("Count:", players.length);
  console.log("First entry keys:", Object.keys(players[0]));
  console.log("First entry:", JSON.stringify(players[0], null, 2).slice(0, 2000));
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
