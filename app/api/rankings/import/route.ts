import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveFormats,
  getAvailableSources,
  resolveSourceForFormat,
  describeSource,
} from "@/lib/source";
import {
  isBoardScope,
  readSleeperId,
  type ImportedRankingPlayer,
} from "@/lib/ranking-boards";

// Mirror the public rankings board (/rankings) so an import matches exactly
// what the user sees there: current season, season-long (week null) rankings.
const MAX_ROWS = 1000;

/**
 * GET /api/rankings/import?format=&source=&scope=
 *
 * Returns the players from our current rankings for a given (source, format),
 * scoped to a single position or "overall", in overall-rank order. Backs the
 * "Import from FF Beacon rankings" action on a custom board so users can start
 * from our rankings and customize instead of building from scratch.
 *
 * Auth: signed-in users only, same-origin only (x-requested-with).
 *
 * The (source, format) pair is resolved through resolveSourceForFormat, so if
 * the requested source doesn't cover the format we fall back to one that does
 * and report it via `fellBack` for the UI to surface.
 */
export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const formatSlug = url.searchParams.get("format") ?? "";
  const requestedSource = url.searchParams.get("source");
  const scope = url.searchParams.get("scope") ?? "overall";

  if (!isBoardScope(scope)) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  const [formats, registry] = await Promise.all([
    getActiveFormats(supabase),
    getAvailableSources(supabase),
  ]);

  const format = formats.find((f) => f.slug === formatSlug);
  if (!format) {
    return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  }

  const resolution = resolveSourceForFormat(
    registry,
    "rankings",
    format.slug,
    requestedSource,
  );

  if (!resolution.source) {
    return NextResponse.json({
      players: [] satisfies ImportedRankingPlayer[],
      source: null,
      sourceDisplay: null,
      requestedDisplay: describeSource(registry, requestedSource),
      formatDisplay: format.display_name,
      fellBack: false,
    });
  }

  let query = supabase
    .from("rankings")
    .select(
      "overall_rank, tier, players!inner(id, slug, first_name, last_name, full_name, position, team, external_ids)",
    )
    .eq("format_config_id", format.id)
    .eq("source", resolution.source)
    // No season filter. lib/seed-rankings.ts derives the season from
    // currentNflSeason() and sweeps every other one, so the table holds
    // exactly one. Pinning a constant here is what used to risk this
    // reader and the writer drifting apart and silently serving a frozen
    // board, and it would also blank the page for the hours between the
    // March rollover and that night's write.
    .is("week", null)
    .order("overall_rank", { ascending: true })
    .limit(MAX_ROWS);

  if (scope !== "overall") {
    query = query.eq("players.position", scope);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[rankings/import] query failed", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }

  const players: ImportedRankingPlayer[] = (data ?? []).map((row) => {
    const typed = row as unknown as {
      tier: number | null;
      players: {
        id: string;
        slug: string;
        first_name: string;
        last_name: string;
        full_name: string | null;
        position: string;
        team: string | null;
        external_ids: Record<string, unknown> | null;
      };
    };
    const p = typed.players;
    return {
      playerId: p.id,
      slug: p.slug,
      name: p.full_name ?? `${p.first_name} ${p.last_name}`,
      position: p.position,
      team: p.team,
      sleeperId: readSleeperId(p.external_ids),
      tier: typed.tier,
    };
  });

  return NextResponse.json({
    players,
    source: resolution.source,
    sourceDisplay: describeSource(registry, resolution.source),
    requestedDisplay: describeSource(registry, resolution.requested),
    formatDisplay: format.display_name,
    fellBack: resolution.fellBack,
  });
}
