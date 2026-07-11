import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveUserIdentities } from "@/lib/user-identity";
import { formatEastern, formatRelative } from "@/lib/datetime";
import {
  evaluatePlayerEligibility,
  type PlayerEligibilityInput,
} from "@/lib/signal-scout/eligibility";
import { loadStatsBundle } from "@/lib/signal-scout/stats-bundle";
import {
  assembleClueFacts,
  generateClueCandidates,
  applyDisabledKeys,
  computeClueCoverage,
  type ClueFactsPlayer,
} from "@/lib/signal-scout/clues";
import type { SignalScoutSettings, SignalTier } from "@/lib/signal-scout/types";

/** Mirrors RANKINGS_WINDOW_DAYS in lib/signal-scout/eligibility.ts (not exported there). */
const RANKINGS_WINDOW_DAYS = 90;

const TIER_ORDER: SignalTier[] = ["weak", "clear", "ping", "scan"];

type DetailPlayerRow = ClueFactsPlayer & {
  first_name: string;
  full_name: string | null;
};

async function loadDetailPlayer(
  admin: ReturnType<typeof createAdminClient>,
  playerId: string,
): Promise<DetailPlayerRow | null> {
  const { data, error } = await admin
    .from("players")
    .select(
      "id, position, first_name, last_name, full_name, birth_date, years_experience, height_inches, weight_lbs, college, team, metadata",
    )
    .eq("id", playerId)
    .maybeSingle();
  if (error) {
    console.error("[signal-scout-admin] player detail lookup failed", error);
    return null;
  }
  return data;
}

async function isInRankingsWindow(admin: ReturnType<typeof createAdminClient>, playerId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - RANKINGS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("rankings")
    .select("player_id")
    .eq("player_id", playerId)
    .gte("generated_at", cutoff)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[signal-scout-admin] player detail rankings window lookup failed", error);
    return false;
  }
  return data !== null;
}

function checkChipClass(pass: boolean): string {
  return pass
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-signal-danger/40 bg-signal-danger/10 text-signal-danger";
}

/**
 * Per-player eligibility detail (SS-T038). Renders all five checks with real
 * clue coverage, computed the same way startRound's lazy-verify seam
 * computes it for its picked candidate (lib/signal-scout/round-engine.ts
 * selectTarget, around lines 411-419): load the stats bundle, assemble clue
 * facts, generate candidates, apply the live disabled-key settings, then
 * compute coverage. This is the ONLY place on the Players page that pays for
 * a stats bundle load, and it only ever runs for the ONE player being
 * inspected.
 */
export async function PlayerDetailPanel({
  playerId,
  settings,
}: {
  playerId: string;
  settings: SignalScoutSettings;
}) {
  const admin = createAdminClient();

  const player = await loadDetailPlayer(admin, playerId);
  if (!player) {
    return (
      <section
        aria-labelledby="player-detail-heading"
        className="mt-6 rounded-card border border-line bg-surface/40 p-6"
      >
        <h2 id="player-detail-heading" className="text-lg font-semibold text-ink">
          Player not found
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          No player matches that id.{" "}
          <Link href="/admin/signal-scout/players" className="text-brand-cyan underline underline-offset-2">
            Back to the full list
          </Link>
          .
        </p>
      </section>
    );
  }

  const [inRankingsWindow, overrideRes, targetCountRes] = await Promise.all([
    isInRankingsWindow(admin, playerId),
    admin
      .from("signal_scout_player_overrides")
      .select("is_hidden, admin_note, updated_by, updated_at")
      .eq("player_id", playerId)
      .maybeSingle(),
    admin.from("signal_scout_rounds").select("id", { count: "exact", head: true }).eq("target_player_id", playerId),
  ]);

  if (overrideRes.error) {
    console.error("[signal-scout-admin] player detail override lookup failed", overrideRes.error);
  }
  if (targetCountRes.error) {
    console.error("[signal-scout-admin] player detail target count failed", targetCountRes.error);
  }

  const override = overrideRes.data ?? null;
  const isHidden = Boolean(override?.is_hidden);
  const timesTargeted = targetCountRes.count ?? 0;

  const statsBundle = await loadStatsBundle(admin, playerId);
  const facts = await assembleClueFacts(admin, player, statsBundle);
  const rawCandidates = generateClueCandidates(facts);
  const candidates = applyDisabledKeys(rawCandidates, settings.clues.disabled_clue_keys);
  const coverage = computeClueCoverage(candidates);

  const evalInput: PlayerEligibilityInput = {
    id: player.id,
    position: player.position,
    birth_date: player.birth_date,
    years_experience: player.years_experience,
    height_inches: player.height_inches,
    weight_lbs: player.weight_lbs,
    inRankingsWindow,
    hiddenOverride: isHidden,
    eligiblePositions: settings.pool.eligible_positions,
    clueCoverage: coverage,
  };
  const result = evaluatePlayerEligibility(evalInput);

  const displayName = player.full_name || `${player.first_name} ${player.last_name}`.trim() || "Unknown player";

  const identities = override?.updated_by
    ? await resolveUserIdentities(admin, [override.updated_by], "private")
    : null;
  const updatedByName = override?.updated_by
    ? (identities?.get(override.updated_by)?.displayName ?? "Unknown admin")
    : null;

  return (
    <section
      aria-labelledby="player-detail-heading"
      className="mt-6 rounded-card border border-line bg-surface/40 p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="player-detail-heading" className="text-lg font-semibold text-ink">
            {displayName}
            <span className="ml-2 text-sm font-normal text-ink-muted">
              {player.position}
              {player.team ? ` - ${player.team}` : ""}
            </span>
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Overall: <span className="font-semibold text-ink">{result.eligible ? "Eligible" : "Not eligible"}</span>.
            Times targeted: {timesTargeted}.
          </p>
        </div>
        <Link
          href="/admin/signal-scout/players"
          className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Close detail
        </Link>
      </div>

      <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        Eligibility checks
      </h3>
      <ul role="list" className="mt-2 space-y-3">
        {result.checks.map((check) => (
          <li key={check.key} className="rounded-card border border-line bg-surface/60 p-3">
            <p className="text-sm text-ink">
              <span
                className={`mr-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${checkChipClass(check.pass)}`}
              >
                {check.pass ? "Pass" : "Fail"}
              </span>
              <span className="font-semibold">{check.label}</span>
            </p>
            <p className="mt-1 text-sm text-ink-muted">{check.detail}</p>
            {check.key === "clue_coverage" ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-subtle sm:grid-cols-3">
                <div>
                  <dt className="inline font-semibold">Starter candidates: </dt>
                  <dd className="inline">{coverage.starterCandidates}</dd>
                </div>
                {TIER_ORDER.map((tier) => (
                  <div key={tier}>
                    <dt className="inline font-semibold capitalize">{tier} generatable: </dt>
                    <dd className="inline">{coverage.generatableByTier[tier]}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-subtle">
        Admin hide state
      </h3>
      <div className="mt-2 rounded-card border border-line bg-surface/60 p-3 text-sm text-ink-muted">
        <p>
          Hidden: <span className="font-semibold text-ink">{isHidden ? "Yes" : "No"}</span>
        </p>
        {override ? (
          <>
            <p className="mt-1">
              Note: {override.admin_note && override.admin_note.trim() ? override.admin_note : "(none)"}
            </p>
            <p className="mt-1">
              Updated by {updatedByName ?? "Unknown admin"},{" "}
              <span title={formatEastern(override.updated_at)}>{formatRelative(override.updated_at)}</span>
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
