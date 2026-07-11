import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { SignalScoutSubnav } from "@/components/admin/signal-scout-subnav";
import { Pager } from "@/components/admin/pager";
import {
  evaluatePlayerEligibility,
  loadEligiblePool,
  listEligibilityChecks,
  type PlayerEligibilityInputWithoutCoverage,
  type EligibilityCheckKey,
} from "@/lib/signal-scout/eligibility";
import { loadSignalScoutSettings } from "@/lib/signal-scout/settings";
import type { SignalScoutSettings } from "@/lib/signal-scout/types";
import { PlayerModeration } from "./player-moderation";
import { PlayerDetailPanel } from "./player-detail-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Signal Scout Players" };

const PAGE_SIZE = 25;
/** Mirrors RANKINGS_WINDOW_DAYS in lib/signal-scout/eligibility.ts (not exported there). */
const RANKINGS_WINDOW_DAYS = 90;
/** Guard on the per-page target-count query; the .in() scope already bounds it to PAGE_SIZE ids. */
const MAX_ROUND_COUNT_ROWS = 10000;
const NOTE_EXCERPT_LENGTH = 40;

const playerIdParamSchema = z.string().uuid();

/** The four cheap checks the summary table can afford to show for the whole pool. */
const CHEAP_CHECK_KEYS: EligibilityCheckKey[] = [
  "position",
  "rankings_window",
  "required_fields",
  "not_hidden",
];

type OverrideRow = {
  player_id: string;
  is_hidden: boolean;
  admin_note: string | null;
  updated_by: string | null;
  updated_at: string;
};

type DisplayRow = {
  id: string;
  full_name: string | null;
  first_name: string;
  last_name: string;
  position: string;
  team: string | null;
};

type PoolPlayer = {
  id: string;
  displayName: string;
  position: string;
  team: string | null;
  eligibilityInput: PlayerEligibilityInputWithoutCoverage;
};

function fmtCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function displayNameFor(row: { full_name: string | null; first_name: string; last_name: string }): string {
  return row.full_name || `${row.first_name} ${row.last_name}`.trim() || "Unknown player";
}

/**
 * Assembles the full candidate list for the Players screen: the structural
 * pool from lib/signal-scout/eligibility.ts loadEligiblePool (which already
 * includes any hidden player whose position is still in the admin-configured
 * pool), PLUS any hidden player whose position fell outside that pool (an
 * override left over from a since-changed positions setting, or a hide on a
 * position never in scope). Without this merge step those players would be
 * hidden from the target pool but invisible on the one screen meant to
 * explain and reverse hides.
 *
 * Query count: loadEligiblePool's own 3 queries (players by position,
 * rankings window, hidden ids) + 1 for the full overrides table (used here
 * for the merge AND reused for the Hidden/note/updated_at column so it is
 * not re-fetched later) + 1 for display fields (name/team) on the same
 * position-filtered pool + at most 2 more (players, rankings window) for any
 * orphaned hidden ids outside the pool. Six to eight queries total for the
 * whole ~700-player pool; none of them touch stats or clue generation.
 */
async function loadPoolPlayers(
  admin: ReturnType<typeof createAdminClient>,
  settings: SignalScoutSettings,
): Promise<{ poolPlayers: PoolPlayer[]; overrides: OverrideRow[] }> {
  const [rawPool, displayRes, overridesRes] = await Promise.all([
    loadEligiblePool(admin, settings),
    admin
      .from("players")
      .select("id, full_name, first_name, last_name, position, team")
      .in("position", settings.pool.eligible_positions)
      .limit(20000),
    admin
      .from("signal_scout_player_overrides")
      .select("player_id, is_hidden, admin_note, updated_by, updated_at"),
  ]);

  if (displayRes.error) throw displayRes.error;
  if (overridesRes.error) throw overridesRes.error;

  const overrides = overridesRes.data ?? [];
  const displayById = new Map<string, DisplayRow>((displayRes.data ?? []).map((row) => [row.id, row]));

  const poolIds = new Set(rawPool.map((p) => p.id));
  const missingHiddenIds = overrides
    .filter((o) => o.is_hidden && !poolIds.has(o.player_id))
    .map((o) => o.player_id);

  const extraInputs: PlayerEligibilityInputWithoutCoverage[] = [];
  if (missingHiddenIds.length > 0) {
    const cutoff = new Date(Date.now() - RANKINGS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const [extraPlayersRes, extraRankedRes] = await Promise.all([
      admin
        .from("players")
        .select("id, full_name, first_name, last_name, position, birth_date, years_experience, height_inches, weight_lbs, team")
        .in("id", missingHiddenIds),
      admin.from("rankings").select("player_id").in("player_id", missingHiddenIds).gte("generated_at", cutoff),
    ]);
    if (extraPlayersRes.error) throw extraPlayersRes.error;
    if (extraRankedRes.error) throw extraRankedRes.error;

    const extraRankedIds = new Set((extraRankedRes.data ?? []).map((r) => r.player_id));
    for (const p of extraPlayersRes.data ?? []) {
      displayById.set(p.id, p);
      extraInputs.push({
        id: p.id,
        position: p.position,
        birth_date: p.birth_date,
        years_experience: p.years_experience,
        height_inches: p.height_inches,
        weight_lbs: p.weight_lbs,
        inRankingsWindow: extraRankedIds.has(p.id),
        hiddenOverride: true,
        eligiblePositions: settings.pool.eligible_positions,
      });
    }
  }

  const combined = [...rawPool, ...extraInputs];
  const poolPlayers: PoolPlayer[] = combined.map((input) => {
    const display = displayById.get(input.id);
    return {
      id: input.id,
      displayName: display ? displayNameFor(display) : "Unknown player",
      position: input.position,
      team: display?.team ?? null,
      eligibilityInput: input,
    };
  });

  return { poolPlayers, overrides };
}

function noteExcerpt(note: string | null): string {
  if (!note || !note.trim()) return "";
  const trimmed = note.trim();
  return trimmed.length > NOTE_EXCERPT_LENGTH ? `${trimmed.slice(0, NOTE_EXCERPT_LENGTH)}...` : trimmed;
}

function CheckChip({ pass, detail }: { pass: boolean; detail: string }) {
  return (
    <span
      title={detail}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        pass
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-signal-danger/40 bg-signal-danger/10 text-signal-danger"
      }`}
    >
      {pass ? "Pass" : "Fail"}
      <span className="sr-only">: {detail}</span>
    </span>
  );
}

function buildPlayersHref(params: { q?: string; playersPage?: number; player?: string }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.playersPage && params.playersPage > 1) search.set("playersPage", String(params.playersPage));
  if (params.player) search.set("player", params.player);
  const qs = search.toString();
  return qs ? `/admin/signal-scout/players?${qs}` : "/admin/signal-scout/players";
}

export default async function SignalScoutPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ playersPage?: string; q?: string; player?: string }>;
}) {
  // Independent re-check (defense in depth alongside the layout gate).
  await requireAdmin("/admin/signal-scout/players");

  const { playersPage, q: qParam, player: playerParam } = await searchParams;
  const playersPageNum = Math.max(1, Number.parseInt(playersPage ?? "1", 10) || 1);
  const q = (qParam ?? "").trim();

  const admin = createAdminClient();

  // loadSignalScoutSettings never throws (it falls back to
  // DEFAULT_SIGNAL_SCOUT_SETTINGS on any read/parse failure), so only the
  // pool load needs a try/catch: loadEligiblePool and the merge queries in
  // loadPoolPlayers throw on a real DB error.
  const settings: SignalScoutSettings = await loadSignalScoutSettings(admin);

  let poolPlayers: PoolPlayer[] = [];
  let overrides: OverrideRow[] = [];
  let loadFailed = false;

  try {
    const loaded = await loadPoolPlayers(admin, settings);
    poolPlayers = loaded.poolPlayers;
    overrides = loaded.overrides;
  } catch (err) {
    console.error("[signal-scout-admin] players pool load failed", err);
    loadFailed = true;
  }

  const totalPoolCount = poolPlayers.length;
  const hiddenCount = overrides.filter((o) => o.is_hidden).length;
  const overrideById = new Map(overrides.map((o) => [o.player_id, o]));

  const filtered = q
    ? poolPlayers.filter((p) => p.displayName.toLowerCase().includes(q.toLowerCase()))
    : poolPlayers;
  const sorted = [...filtered].sort((a, b) => a.displayName.localeCompare(b.displayName));

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, playersPageNum), totalPages);
  const from = (currentPage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(from, from + PAGE_SIZE);

  const pageIds = pageItems.map((p) => p.id);
  const { data: targetRows, error: targetError } = pageIds.length
    ? await admin
        .from("signal_scout_rounds")
        .select("target_player_id")
        .in("target_player_id", pageIds)
        .limit(MAX_ROUND_COUNT_ROWS)
    : { data: [], error: null };
  if (targetError) {
    console.error("[signal-scout-admin] players target-count query failed", targetError);
  }
  const targetCountById = new Map<string, number>();
  for (const row of targetRows ?? []) {
    targetCountById.set(row.target_player_id, (targetCountById.get(row.target_player_id) ?? 0) + 1);
  }

  const cheapCheckDefs = listEligibilityChecks().filter((def) => CHEAP_CHECK_KEYS.includes(def.key));

  let selectedPlayerId: string | null = null;
  let selectedPlayerInvalid = false;
  if (playerParam) {
    const parsed = playerIdParamSchema.safeParse(playerParam);
    if (parsed.success) {
      selectedPlayerId = parsed.data;
    } else {
      selectedPlayerInvalid = true;
    }
  }

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Players</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Per-player eligibility checks for the Signal Scout target pool: why a player is in or
          out, how often they have been a target, and admin hide/unhide with a required note.
        </p>
      </div>

      <SignalScoutSubnav />

      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        {loadFailed ? (
          <ErrorBox message="Could not load the Signal Scout player pool." />
        ) : (
          <>
            {selectedPlayerInvalid ? (
              <div className="rounded-card border border-line bg-surface/40 p-6">
                <p className="text-sm text-ink-muted">That player id is not valid.</p>
              </div>
            ) : selectedPlayerId ? (
              <PlayerDetailPanel playerId={selectedPlayerId} settings={settings} />
            ) : null}

            <section aria-labelledby="players-list-heading">
              <h2 id="players-list-heading" className="sr-only">
                Player pool
              </h2>

              <form
                method="GET"
                role="search"
                aria-label="Search Signal Scout players"
                className="flex flex-wrap items-end gap-3"
              >
                <div className="flex flex-col gap-1">
                  <label htmlFor="players-search" className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    Search players by name
                  </label>
                  <input
                    id="players-search"
                    type="text"
                    name="q"
                    defaultValue={q}
                    className="min-h-11 w-64 rounded-card border border-line bg-surface px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Search
                </button>
                {q ? (
                  <Link
                    href="/admin/signal-scout/players"
                    className="text-sm text-brand-cyan underline underline-offset-2"
                  >
                    Clear search
                  </Link>
                ) : null}
              </form>

              <p className="mt-4 text-sm text-ink-muted">
                {fmtCount(totalPoolCount)} players in the candidate pool, {fmtCount(hiddenCount)} hidden.
                {q ? ` Showing ${fmtCount(sorted.length)} matching "${q}".` : ""}
              </p>

              {sorted.length === 0 ? (
                <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
                  No players match that search.
                </p>
              ) : (
                <>
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Signal Scout player pool table, scrollable"
                    className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    <table className="w-max min-w-full border-collapse text-sm">
                      <caption className="sr-only">
                        Signal Scout candidate pool with per-player eligibility checks, page {currentPage} of{" "}
                        {totalPages}.
                      </caption>
                      <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Player
                          </th>
                          {cheapCheckDefs.map((def) => (
                            <th key={def.key} scope="col" className="px-3 py-2 text-left font-semibold">
                              {def.label}
                            </th>
                          ))}
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Times targeted
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Hidden
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageItems.map((p) => {
                          const cheapResult = evaluatePlayerEligibility({
                            ...p.eligibilityInput,
                            clueCoverage: null,
                          });
                          const checksByKey = new Map(cheapResult.checks.map((c) => [c.key, c]));
                          const override = overrideById.get(p.id) ?? null;
                          const isHidden = Boolean(override?.is_hidden);
                          const excerpt = noteExcerpt(override?.admin_note ?? null);

                          return (
                            <tr key={p.id} className="border-t border-line/60 align-top">
                              <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                                {p.displayName}
                                <span className="ml-1.5 text-xs text-ink-subtle">
                                  {p.position}
                                  {p.team ? ` - ${p.team}` : ""}
                                </span>
                              </th>
                              {cheapCheckDefs.map((def) => {
                                const check = checksByKey.get(def.key);
                                return (
                                  <td key={def.key} className="px-3 py-2">
                                    {check ? <CheckChip pass={check.pass} detail={check.detail} /> : null}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 text-ink">{targetCountById.get(p.id) ?? 0}</td>
                              <td className="px-3 py-2 text-ink-muted">
                                {isHidden ? `Yes${excerpt ? ` - ${excerpt}` : ""}` : "No"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-col gap-2">
                                  <Link
                                    href={buildPlayersHref({ q, playersPage: currentPage, player: p.id })}
                                    className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                                  >
                                    Detail
                                  </Link>
                                  <PlayerModeration playerId={p.id} playerName={p.displayName} isHidden={isHidden} />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pager
                    basePath="/admin/signal-scout/players"
                    paramName="playersPage"
                    currentPage={currentPage}
                    totalPages={totalPages}
                    label="Player pool pages"
                    extraParams={q ? { q } : undefined}
                  />
                </>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-sm text-signal-danger">
      {message}
    </p>
  );
}
