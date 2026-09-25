import { extractKtcPlayers } from "../lib/ktc-page";

async function main() {
  const url = "https://keeptradecut.com/dynasty-rankings?format=1";
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
  });
  const html = await response.text();
  const extracted = extractKtcPlayers(html);
  if (!extracted) {
    console.log("no player list in the page");
    return;
  }
  const players = extracted.players as Array<Record<string, unknown>>;
  console.log("Layout:", extracted.layout);
  console.log("Count:", players.length);
  console.log("First entry keys:", Object.keys(players[0]));
  console.log("First entry:", JSON.stringify(players[0], null, 2).slice(0, 2000));
}
main();
