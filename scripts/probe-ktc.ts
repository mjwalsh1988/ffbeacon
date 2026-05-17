async function main() {
  const url = "https://keeptradecut.com/dynasty-rankings?format=1";
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
  });
  const html = await response.text();
  const match = html.match(/var\s+playersArray\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    console.log("no playersArray");
    return;
  }
  const players = JSON.parse(match[1]) as Array<Record<string, unknown>>;
  console.log("Count:", players.length);
  console.log("First entry keys:", Object.keys(players[0]));
  console.log("First entry:", JSON.stringify(players[0], null, 2).slice(0, 2000));
}
main();
