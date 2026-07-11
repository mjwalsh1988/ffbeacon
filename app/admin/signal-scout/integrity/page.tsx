import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { currentEasternGameDate } from "@/lib/signal-scout/streaks";
import { resolveUserIdentities } from "@/lib/user-identity";
import { formatEastern, formatRelative } from "@/lib/datetime";
import { SignalScoutSubnav } from "@/components/admin/signal-scout-subnav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Signal Scout Integrity" };

const BURNOUT_MIN_ROUNDS = 3;
const BURNOUT_LIMIT = 15;
const GUESS_WINDOW_LIMIT = 2000;
const RAPID_GUESS_THRESHOLD_MS = 2000;
const RAPID_GUESS_DISPLAY_LIMIT = 20;
const SEARCH_VOLUME_LIMIT = 15;
const SEARCH_VOLUME_LOOKBACK_DAYS = 7;

interface BurnoutRow {
  user_id: string;
  rounds_played: number;
  rounds_burned: number;
  rounds_solved_late: number;
  hidden_from_leaderboards: boolean;
}

interface RapidGuessPair {
  roundId: string;
  firstGuessNumber: number;
  secondGuessNumber: number;
  deltaMs: number;
  secondCreatedAt: string;
}

interface SearchVolumeRow {
  identity_key: string;
  game_date: string;
  count: number;
  last_at: string;
}

/**
 * Same UTC-noon day math as parseIsoDateUtcNoon in lib/signal-scout/streaks.ts
 * (not exported from there), reimplemented locally so this read-only admin
 * page can compute a 7 ET-day lookback boundary without touching lib.
 */
function easternDateDaysAgo(daysAgo: number): string {
  const today = currentEasternGameDate();
  const [year, month, day] = today.split("-").map(Number);
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  const past = new Date(utcNoon - daysAgo * 86_400_000);
  const y = past.getUTCFullYear();
  const m = String(past.getUTCMonth() + 1).padStart(2, "0");
  const d = String(past.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Finds guess pairs, within the same round, whose created_at timestamps land
 * under RAPID_GUESS_THRESHOLD_MS apart. The guess route claims a 2-second
 * window per action (see try_claim_signal_scout_action via claimAction in
 * lib/signal-scout/route-helpers.ts), so a sub-2-second gap between two
 * guesses in one round suggests a replayed request or a claim-window bypass
 * attempt rather than normal play. Only strictly consecutive guess numbers
 * (n, n+1) are compared so a gap introduced by the fixed 2000-row fetch
 * window never produces a false pair.
 */
function findRapidGuessPairs(
  guesses: Array<{ round_id: string; guess_number: number; created_at: string }>,
): RapidGuessPair[] {
  const byRound = new Map<string, Array<{ guess_number: number; created_at: string }>>();
  for (const g of guesses) {
    const list = byRound.get(g.round_id) ?? [];
    list.push({ guess_number: g.guess_number, created_at: g.created_at });
    byRound.set(g.round_id, list);
  }

  const pairs: RapidGuessPair[] = [];
  for (const [roundId, list] of byRound) {
    list.sort((a, b) => a.guess_number - b.guess_number);
    for (let i = 0; i < list.length - 1; i++) {
      const curr = list[i];
      const next = list[i + 1];
      if (next.guess_number !== curr.guess_number + 1) continue;
      const deltaMs = new Date(next.created_at).getTime() - new Date(curr.created_at).getTime();
      if (deltaMs >= 0 && deltaMs < RAPID_GUESS_THRESHOLD_MS) {
        pairs.push({
          roundId,
          firstGuessNumber: curr.guess_number,
          secondGuessNumber: next.guess_number,
          deltaMs,
          secondCreatedAt: next.created_at,
        });
      }
    }
  }

  pairs.sort((a, b) => new Date(b.secondCreatedAt).getTime() - new Date(a.secondCreatedAt).getTime());
  return pairs;
}

/**
 * Signal Scout admin integrity panel (SS-T037). Read-only surfacing of three
 * abuse signals: burnout/late-solve concentration, sub-2-second guess pairs,
 * and high per-identity search volume. No mutations happen here; the hide
 * action lives on /admin/signal-scout/users.
 */
export default async function SignalScoutIntegrityPage() {
  // Independent re-check (defense in depth alongside the layout gate).
  await requireAdmin("/admin/signal-scout/integrity");

  const admin = createAdminClient();
  const searchLookbackDate = easternDateDaysAgo(SEARCH_VOLUME_LOOKBACK_DAYS);

  const [burnoutRes, guessesRes, searchVolumeRes] = await Promise.all([
    // Two conditions merged into one .or() filter rather than two separate
    // queries deduped in memory: simpler, and the DB can sort/limit directly.
    admin
      .from("signal_scout_user_stats")
      .select("user_id, rounds_played, rounds_burned, rounds_solved_late, hidden_from_leaderboards")
      .or(`rounds_burned.gte.${BURNOUT_MIN_ROUNDS},rounds_solved_late.gte.${BURNOUT_MIN_ROUNDS}`)
      .order("rounds_burned", { ascending: false })
      .limit(BURNOUT_LIMIT),
    admin
      .from("signal_scout_guesses")
      .select("round_id, guess_number, created_at")
      .order("created_at", { ascending: false })
      .limit(GUESS_WINDOW_LIMIT),
    admin
      .from("signal_scout_activity_counters")
      .select("identity_key, game_date, count, last_at")
      .eq("action", "search")
      .gte("game_date", searchLookbackDate)
      .order("count", { ascending: false })
      .limit(SEARCH_VOLUME_LIMIT),
  ]);

  if (burnoutRes.error) {
    console.error("[signal-scout-admin] integrity burnout query failed", burnoutRes.error);
  }
  if (guessesRes.error) {
    console.error("[signal-scout-admin] integrity guesses window query failed", guessesRes.error);
  }
  if (searchVolumeRes.error) {
    console.error("[signal-scout-admin] integrity search volume query failed", searchVolumeRes.error);
  }

  const burnoutRows: BurnoutRow[] = burnoutRes.data ?? [];
  const rapidPairs = findRapidGuessPairs(guessesRes.data ?? []).slice(0, RAPID_GUESS_DISPLAY_LIMIT);
  const searchVolumeRows: SearchVolumeRow[] = searchVolumeRes.data ?? [];
  const burnoutFailed = Boolean(burnoutRes.error);
  const searchVolumeFailed = Boolean(searchVolumeRes.error);

  const rapidRoundIds = [...new Set(rapidPairs.map((p) => p.roundId))];
  const { data: rapidRoundsData, error: rapidRoundsError } = rapidRoundIds.length
    ? await admin.from("signal_scout_rounds").select("id, user_id, guest_id").in("id", rapidRoundIds)
    : { data: [], error: null };
  if (rapidRoundsError) {
    console.error("[signal-scout-admin] integrity rapid guess round lookup failed", rapidRoundsError);
  }
  const rapidGuessesFailed = Boolean(guessesRes.error) || Boolean(rapidRoundsError);
  const rapidRoundById = new Map((rapidRoundsData ?? []).map((r) => [r.id, r]));

  const searchVolumeUserIds = searchVolumeRows
    .filter((row) => row.identity_key.startsWith("user:"))
    .map((row) => row.identity_key.slice("user:".length));
  const rapidRoundUserIds = (rapidRoundsData ?? [])
    .filter((r): r is typeof r & { user_id: string } => Boolean(r.user_id))
    .map((r) => r.user_id);

  const allUserIds = [
    ...new Set([...burnoutRows.map((r) => r.user_id), ...rapidRoundUserIds, ...searchVolumeUserIds]),
  ];
  const identities = await resolveUserIdentities(admin, allUserIds, "private");

  const nowMs = Date.now();

  function burnRateLabel(burned: number, played: number): { text: string; srOnly?: string } {
    if (played <= 0) return { text: "-", srOnly: "no data" };
    return { text: `${((burned / played) * 100).toFixed(1)}%` };
  }

  function scoutLabelForRound(round: { user_id: string | null; guest_id: string | null } | undefined) {
    if (!round) return "Unknown scout";
    if (round.user_id) return identities.get(round.user_id)?.displayName ?? "Unknown scout";
    if (round.guest_id) return `Guest ${round.guest_id.slice(0, 8)}`;
    return "Unknown scout";
  }

  function identityLabel(identityKey: string): { text: string; mono: boolean } {
    const [prefix, rest] = identityKey.split(":", 2);
    if (prefix === "user" && rest) {
      return { text: identities.get(rest)?.displayName ?? "Unknown scout", mono: false };
    }
    if (prefix === "guest" && rest) {
      return { text: `Guest ${rest.slice(0, 8)}`, mono: true };
    }
    if (prefix === "ip" && rest) {
      return { text: `IP ${rest.slice(0, 8)}`, mono: true };
    }
    return { text: identityKey, mono: true };
  }

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Integrity</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Suspicious activity patterns for the Signal Scout guessing game: heavy burnout and
          repeated 0-point solves, sub-2-second guess pairs, and unusually high search volume per
          identity. This panel is read-only; the hide action lives on the Users tab.
        </p>
      </div>

      <SignalScoutSubnav />

      <div className="mx-auto max-w-5xl space-y-12 px-4 py-8 sm:px-6 lg:px-8">
        <section aria-labelledby="burnout-heading">
          <h2 id="burnout-heading" className="text-xl font-semibold tracking-tight text-ink">
            Burnout and late solves
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Scouts with {BURNOUT_MIN_ROUNDS} or more burned rounds or {BURNOUT_MIN_ROUNDS} or more
            rounds solved after the signal burned out (0 points awarded), sorted by burned rounds.
          </p>
          {burnoutFailed ? (
            <ErrorBox message="Could not load burnout and late-solve data." />
          ) : burnoutRows.length === 0 ? (
            <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
              No users with 3 or more burned rounds or late solves yet.
            </p>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Burnout and late solves table, scrollable"
              className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <table className="w-max min-w-full border-collapse text-sm">
                <caption className="sr-only">
                  Scouts with frequent burnouts or late solves, most burned rounds first.
                </caption>
                <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Scout
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Rounds played
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Burned rounds
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Solved late (0 points)
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Burn rate
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Hidden from leaderboards
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {burnoutRows.map((row) => {
                    const rate = burnRateLabel(row.rounds_burned, row.rounds_played);
                    return (
                      <tr key={row.user_id} className="border-t border-line/60 align-top">
                        <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                          {identities.get(row.user_id)?.displayName ?? "Unknown scout"}
                        </th>
                        <td className="px-3 py-2 text-ink">{row.rounds_played}</td>
                        <td className="px-3 py-2 text-ink">{row.rounds_burned}</td>
                        <td className="px-3 py-2 text-ink">{row.rounds_solved_late}</td>
                        <td className="px-3 py-2 text-ink">
                          {rate.text}
                          {rate.srOnly ? <span className="sr-only"> ({rate.srOnly})</span> : null}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">
                          {row.hidden_from_leaderboards ? "Yes" : "No"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="rapid-guesses-heading">
          <h2 id="rapid-guesses-heading" className="text-xl font-semibold tracking-tight text-ink">
            Rapid guesses
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Guess pairs, within the most recent {GUESS_WINDOW_LIMIT.toLocaleString("en-US")} guesses,
            whose timestamps land under 2 seconds apart inside the same round. The guess route
            enforces a 2-second claim window, so a pair this close suggests a replayed request or a
            claim-window bypass attempt.
          </p>
          {rapidGuessesFailed ? (
            <ErrorBox message="Could not load rapid-guess data." />
          ) : rapidPairs.length === 0 ? (
            <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
              No sub-2-second guess pairs in the most recent 2000 guesses.
            </p>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Rapid guesses table, scrollable"
              className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <table className="w-max min-w-full border-collapse text-sm">
                <caption className="sr-only">
                  Most recent sub-2-second guess pairs, newest first.
                </caption>
                <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      When
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Scout
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Round id
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Guess numbers
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Delta
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rapidPairs.map((pair, index) => {
                    const round = rapidRoundById.get(pair.roundId);
                    return (
                      <tr
                        key={`${pair.roundId}-${pair.secondGuessNumber}-${index}`}
                        className="border-t border-line/60 align-top"
                      >
                        <th scope="row" className="px-3 py-2 text-left text-xs font-normal text-ink-muted">
                          <span title={formatEastern(pair.secondCreatedAt)}>
                            {formatRelative(pair.secondCreatedAt, nowMs)}
                          </span>
                        </th>
                        <td className="px-3 py-2 text-ink">{scoutLabelForRound(round)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-subtle" title={pair.roundId}>
                          <span aria-hidden="true">{pair.roundId.slice(0, 8)}</span>
                          <span className="sr-only">{pair.roundId}</span>
                        </td>
                        <td className="px-3 py-2 text-ink">
                          {pair.firstGuessNumber} to {pair.secondGuessNumber}
                        </td>
                        <td className="px-3 py-2 font-mono text-ink">{pair.deltaMs} ms</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="search-volume-heading">
          <h2 id="search-volume-heading" className="text-xl font-semibold tracking-tight text-ink">
            Search volume
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Highest player-search counts per identity per ET game day, over the last{" "}
            {SEARCH_VOLUME_LOOKBACK_DAYS} days.
          </p>
          {searchVolumeFailed ? (
            <ErrorBox message="Could not load search volume data." />
          ) : searchVolumeRows.length === 0 ? (
            <p className="mt-4 rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
              No unusually high search volume in the last 7 days.
            </p>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Search volume table, scrollable"
              className="mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <table className="w-max min-w-full border-collapse text-sm">
                <caption className="sr-only">
                  Top search volume by identity and ET game day, most searches first.
                </caption>
                <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Identity
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Game day
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Searches
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Last activity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {searchVolumeRows.map((row, index) => {
                    const label = identityLabel(row.identity_key);
                    return (
                      <tr
                        key={`${row.identity_key}-${row.game_date}-${index}`}
                        className="border-t border-line/60 align-top"
                      >
                        <th
                          scope="row"
                          className={`px-3 py-2 text-left font-normal text-ink ${label.mono ? "font-mono text-xs" : ""}`}
                        >
                          {label.text}
                        </th>
                        <td className="px-3 py-2 text-ink">{row.game_date}</td>
                        <td className="px-3 py-2 text-ink">{row.count}</td>
                        <td className="px-3 py-2 text-ink-muted">
                          <span title={formatEastern(row.last_at)}>
                            {formatRelative(row.last_at, nowMs)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="rounded-card border border-line bg-surface/40 p-4 text-sm text-ink-muted">
          <p>
            <strong className="text-ink">How to act on this:</strong> these tables surface
            signals, not verdicts. A high count here does not by itself mean a scout is cheating;
            confirm before acting. Hiding a scout from leaderboards happens on the{" "}
            <Link
              href="/admin/signal-scout/users"
              className="text-brand-cyan underline underline-offset-2"
            >
              Users tab
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="mt-4 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-sm text-signal-danger">
      {message}
    </p>
  );
}
