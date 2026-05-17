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
  const { data: players } = await supabase
    .from("players")
    .select("first_name, last_name, position")
    .ilike("last_name", "Smith-Njigba");
  console.log("Direct DB matches for Smith-Njigba:");
  for (const p of players ?? []) {
    const key = `${normalizeName(`${p.first_name} ${p.last_name}`)}|${p.position}`;
    console.log(`  first="${p.first_name}" last="${p.last_name}" pos="${p.position}" -> key="${key}"`);
    console.log(`  raw bytes first: ${[...p.first_name].map((c) => c.charCodeAt(0).toString(16)).join(" ")}`);
    console.log(`  raw bytes last: ${[...p.last_name].map((c) => c.charCodeAt(0).toString(16)).join(" ")}`);
  }

  // Test the exact KTC key construction
  const ktcName = "Jaxon Smith-Njigba";
  const ktcPos = "WR";
  const ktcKey = `${normalizeName(ktcName)}|${ktcPos}`;
  console.log(`\nKTC key: "${ktcKey}"`);
  console.log(`KTC raw bytes: ${[...ktcKey].map((c) => c.charCodeAt(0).toString(16)).join(" ")}`);
}
main();
