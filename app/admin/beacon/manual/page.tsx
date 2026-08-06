import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getRecomputeStatus, loadPickCoordinates } from "@/lib/beacon-admin";
import { describePickSignal } from "@/lib/beacon/pick-slots";
import { BeaconPageShell } from "@/components/admin/beacon-page-shell";
import { ManualComposer } from "@/components/admin/manual-composer";
import { ManualSignalsList, type ManualSignalItem } from "@/components/admin/manual-signals-list";

export const metadata: Metadata = { title: "Manual signals" };
export const dynamic = "force-dynamic";

const FLAGSHIP = "dynasty-ppr-sflex";

export default async function BeaconManualPage() {
  await requireAdmin("/admin/beacon/manual");
  const admin = createAdminClient();

  const { data: ffRow } = await admin
    .from("source_registry").select("supported_format_slugs").eq("slug", "ffbeacon").single();
  const ffSlugs = ffRow?.supported_format_slugs ?? [];
  const { data: fmtRows } = await admin
    .from("format_configs").select("id, slug, display_order, league_type").order("display_order");
  // Only dynasty boards carry draft picks, so those are the only formats a pick
  // signal can be scoped to.
  const formats = (fmtRows ?? [])
    .filter((f) => ffSlugs.includes(f.slug))
    .map((f) => ({ id: f.id, slug: f.slug, usesPicks: f.league_type === "dynasty" }));
  const slugById = new Map((fmtRows ?? []).map((f) => [f.id, f.slug]));
  const flagshipId = formats.find((f) => f.slug === FLAGSHIP)?.id ?? formats[0]?.id;

  const [composer, active, recompute, pickCoords] = await Promise.all([
    flagshipId
      ? admin
          .from("player_value_trends")
          .select("player_id, current_value, players!inner(first_name, last_name, position, team)")
          .eq("source", "ffbeacon").eq("format_config_id", flagshipId)
          .order("current_value", { ascending: false }).limit(1000)
      : Promise.resolve({ data: [] as never[] }),
    admin
      .from("beacon_manual_signals")
      .select("id, target, player_id, format_config_id, adjustment_type, magnitude, silent, reason, pick_season, pick_round, pick_position, players(first_name, last_name, position)")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    getRecomputeStatus(admin, Date.now()),
    loadPickCoordinates(admin),
  ]);

  const players = (composer.data ?? []).map((t) => {
    const p = t.players as unknown as { first_name: string; last_name: string; position: string; team: string | null };
    return { id: t.player_id, name: `${p.first_name} ${p.last_name}`, position: p.position, team: p.team };
  });

  const signals: ManualSignalItem[] = (active.data ?? []).map((s) => {
    const p = s.players as unknown as { first_name: string; last_name: string; position: string } | null;
    const subject = s.target === "player"
      ? (p ? `${p.first_name} ${p.last_name} (${p.position})` : "Player")
      : describePickSignal(s.pick_season, s.pick_round, s.pick_position);
    const allScope = s.target === "pick" ? "all pick formats" : "all formats";
    return {
      id: s.id,
      target: s.target,
      subject,
      scope: s.format_config_id ? (slugById.get(s.format_config_id) ?? "format") : allScope,
      adjustmentType: s.adjustment_type,
      magnitude: Number(s.magnitude),
      silent: s.silent,
      reason: s.reason,
    };
  });

  return (
    <BeaconPageShell
      title="Manual signals"
      description="Owner nudges read only by the FF Beacon engine. Create a signal below, then recompute to see its effect. Silent player signals change the value but stay out of the trend chips. Draft pick signals target a season and round, one slot or all three, and stack on top of the global pick value multiplier in Settings."
      recompute={recompute}
    >
      <div className="space-y-10">
        <section aria-labelledby="composer-h">
          <h3 id="composer-h" className="mb-4 text-lg font-semibold tracking-tight text-ink">Create a signal</h3>
          <ManualComposer
            players={players}
            formats={formats}
            pickSeasons={pickCoords.seasons}
            pickRounds={pickCoords.rounds}
          />
        </section>
        <section aria-labelledby="active-h">
          <h3 id="active-h" className="mb-4 text-lg font-semibold tracking-tight text-ink">Active signals</h3>
          <ManualSignalsList signals={signals} />
        </section>
      </div>
    </BeaconPageShell>
  );
}
