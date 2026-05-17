import { getServiceClient } from "./_supabase";

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
  const url = "https://keeptradecut.com/dynasty-rankings?format=1";
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 Chrome/120" },
  });
  const html = await response.text();
  const match = html.match(/var\s+playersArray\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return;
  const ktc = JSON.parse(match[1]) as Array<{
    playerName: string;
    position: string;
    team: string;
  }>;

  const { data: players } = await supabase
    .from("players")
    .select("first_name, last_name, position");
  const keys = new Set<string>();
  for (const p of players ?? []) {
    keys.add(`${normalizeName(`${p.first_name} ${p.last_name}`)}|${p.position}`);
  }

  const positionCounts: Record<string, { matched: number; unmatched: number }> = {};
  const unmatchedSample: string[] = [];
  for (const k of ktc) {
    const pos = k.position === "RDP" ? "PICK" : k.position?.toUpperCase();
    if (!pos || pos === "PICK") continue;
    positionCounts[pos] ??= { matched: 0, unmatched: 0 };
    const key = `${normalizeName(k.playerName)}|${pos}`;
    if (keys.has(key)) {
      positionCounts[pos].matched++;
    } else {
      positionCounts[pos].unmatched++;
      if (unmatchedSample.length < 20) {
        unmatchedSample.push(`${k.playerName} (${pos}) -> ${key}`);
      }
    }
  }

  console.log("Per-position:", positionCounts);
  console.log("Unmatched sample:", unmatchedSample);
}
main();
