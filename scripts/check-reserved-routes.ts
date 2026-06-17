// Build-time collision guard (Phase 7).
//
// Runs as `prebuild`, so `npm run build` fails if a Signal handle could ever
// shadow or be shadowed by a real top-level route. It enforces, in this order:
//
//   1. Every top-level folder under app/ (every literal route segment) is
//      present in RESERVED_ROUTE_SEGMENTS. This is the high-frequency guard: a
//      developer who adds app/blog/ and forgets to reserve it cannot ship.
//      Hard fail, no database needed.
//
//   2. Every RESERVED_ROUTE_SEGMENTS entry is present in signal_reserved_handles
//      (the table the 0068 claim-time trigger enforces). This keeps the code
//      constant and the database seed from drifting. Runs only when Supabase
//      credentials are available; otherwise it prints a loud warning and skips
//      that leg rather than wedging a credential-less build.
//
// Dynamic segments ([handle]), route groups ((group)), and private folders
// (_internal) are NOT routable as literal paths and are excluded.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_ROUTE_SEGMENTS } from "../lib/signal/reserved-routes";

const APP_DIR = join(process.cwd(), "app");

function topLevelRouteFolders(): string[] {
  return readdirSync(APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        !name.startsWith("[") && // dynamic segment (e.g. [handle])
        !name.startsWith("(") && // route group (not part of the URL)
        !name.startsWith("_") && // private folder (not routable)
        !name.startsWith("."),
    );
}

function fail(message: string, missing: string[]): never {
  console.error(`\nReserved-route guard FAILED: ${message}`);
  for (const item of missing) console.error(`  - ${item}`);
  console.error(
    "\nFix: update lib/signal/reserved-routes.ts (RESERVED_ROUTE_SEGMENTS) and\n" +
      "add a migration seeding the same handles into signal_reserved_handles.\n",
  );
  process.exit(1);
}

async function main() {
  const reserved = new Set<string>(RESERVED_ROUTE_SEGMENTS);
  const folders = topLevelRouteFolders();

  // Leg 1: filesystem -> code constant (always enforced).
  const missingFromConstant = folders.filter((f) => !reserved.has(f));
  if (missingFromConstant.length > 0) {
    fail(
      "top-level app/ folders are not in RESERVED_ROUTE_SEGMENTS",
      missingFromConstant,
    );
  }

  // Honesty check: a constant entry with no matching folder is stale. This is
  // not dangerous (it only over-reserves), so it is a warning, not a failure.
  const folderSet = new Set(folders);
  const staleConstantEntries = RESERVED_ROUTE_SEGMENTS.filter(
    (s) => !folderSet.has(s),
  );
  if (staleConstantEntries.length > 0) {
    console.warn(
      `Reserved-route guard: RESERVED_ROUTE_SEGMENTS lists segments with no app/ folder: ${staleConstantEntries.join(
        ", ",
      )} (over-reserving; remove if intentional).`,
    );
  }

  // Leg 2: code constant -> database seed (when credentials are present).
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // No .env.local (e.g. CI/Vercel): rely on injected process.env.
    }
  }

  const hasCreds =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY;
  if (!hasCreds) {
    console.warn(
      "\nReserved-route guard: Supabase credentials not found, SKIPPING the\n" +
        "RESERVED_ROUTE_SEGMENTS -> signal_reserved_handles check. The\n" +
        "filesystem -> constant check passed. Run `npm run check:routes` with\n" +
        ".env.local present to verify the database seed.\n",
    );
    console.log(
      `Reserved-route guard: ${folders.length} route folders covered by RESERVED_ROUTE_SEGMENTS.`,
    );
    return;
  }

  const { getServiceClient } = await import("./_supabase");
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("signal_reserved_handles")
    .select("handle")
    .in("handle", [...RESERVED_ROUTE_SEGMENTS]);
  if (error) {
    console.error(
      `\nReserved-route guard: could not read signal_reserved_handles (${error.message}).`,
    );
    process.exit(1);
  }
  const seeded = new Set((data ?? []).map((row) => row.handle.toLowerCase()));
  const missingFromDb = RESERVED_ROUTE_SEGMENTS.filter((s) => !seeded.has(s));
  if (missingFromDb.length > 0) {
    fail(
      "RESERVED_ROUTE_SEGMENTS entries are not seeded in signal_reserved_handles",
      missingFromDb,
    );
  }

  console.log(
    `Reserved-route guard: ${folders.length} route folders covered by RESERVED_ROUTE_SEGMENTS and seeded in signal_reserved_handles.`,
  );
}

main().catch((err) => {
  console.error("Reserved-route guard crashed:", err);
  process.exit(1);
});
