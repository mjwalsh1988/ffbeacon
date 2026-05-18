import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import {
  resolveSourceForFormat,
  getAvailableSources,
  describeSource,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { FaabForm, type FaabPlayer } from "./faab-form";

export const metadata: Metadata = {
  title: "FAAB Calculator",
  description:
    "Recommend a confident waiver wire bid based on market value, league budget, and roster need.",
};

export const dynamic = "force-dynamic";

export default async function FaabPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; source?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const formatResolution = await resolveFormatSlug(supabase, params.format);
  const sourceResolution = await resolveSourceSlug(supabase, params.source);
  const formatSlug = formatResolution.slug;
  const requestedSourceSlug = sourceResolution.slug;
  const { data: format } = await supabase
    .from("format_configs")
    .select("id, slug, display_name")
    .eq("slug", formatSlug)
    .maybeSingle();

  let players: FaabPlayer[] = [];
  let fallbackBanner: { requested: string | null; actual: string } | null = null;
  let rankingsSourceName: string | null = null;
  let valueSourceName: string | null = null;
  if (format) {
    const registry = await getAvailableSources(supabase);
    const rankingsResolution = resolveSourceForFormat(
      registry,
      "rankings",
      format.slug,
      requestedSourceSlug,
    );
    const valueHistoryResolution = resolveSourceForFormat(
      registry,
      "player_value_history",
      format.slug,
      requestedSourceSlug,
    );
    if (rankingsResolution.source) {
      rankingsSourceName = describeSource(registry, rankingsResolution.source);
    }
    if (valueHistoryResolution.source) {
      valueSourceName = describeSource(registry, valueHistoryResolution.source);
    }
    if (rankingsResolution.fellBack && rankingsResolution.source) {
      fallbackBanner = {
        requested: describeSource(registry, rankingsResolution.requested),
        actual: describeSource(registry, rankingsResolution.source),
      };
    }

    if (rankingsResolution.source) {
      const { data } = await supabase
        .from("rankings")
        .select(
          "overall_rank, position_rank, players!inner(slug, first_name, last_name, position, team, external_ids)",
        )
        .eq("format_config_id", format.id)
        .eq("source", rankingsResolution.source)
        .order("overall_rank")
        .limit(300);
      const playerIds: string[] = [];
      const playerInfo = new Map<string, FaabPlayer>();
      for (const row of data ?? []) {
        const player = (row as unknown as {
          players: {
            slug: string;
            first_name: string;
            last_name: string;
            position: string;
            team: string | null;
            external_ids: Record<string, unknown> | null;
          };
        }).players;
        const slug = player.slug;
        // Sleeper id lives on players.external_ids.sleeper. May be missing
        // for older / non-Sleeper-resolved players — headshot falls back to
        // the position badge in that case.
        const sleeperExt = player.external_ids?.sleeper;
        const sleeper_id =
          typeof sleeperExt === "string" && sleeperExt
            ? sleeperExt
            : typeof sleeperExt === "number"
              ? String(sleeperExt)
              : null;
        playerInfo.set(slug, {
          slug,
          name: `${player.first_name} ${player.last_name}`,
          position: player.position,
          team: player.team ?? null,
          sleeper_id,
          overall_rank: row.overall_rank,
          position_rank: row.position_rank,
          value: null,
        });
        playerIds.push(slug);
      }
      const { data: pIds } = await supabase
        .from("players")
        .select("id, slug")
        .in("slug", playerIds.slice(0, 300));
      const slugById = new Map<string, string>();
      for (const p of pIds ?? []) slugById.set(p.id, p.slug);
      if (valueHistoryResolution.source && slugById.size > 0) {
        const { data: values } = await supabase
          .from("player_value_history")
          .select("player_id, value, captured_at")
          .eq("format_config_id", format.id)
          .eq("source", valueHistoryResolution.source)
          .in("player_id", Array.from(slugById.keys()))
          .order("captured_at", { ascending: false });
        const latest = new Map<string, number>();
        for (const v of values ?? []) {
          if (latest.has(v.player_id)) continue;
          latest.set(v.player_id, v.value);
        }
        for (const [id, slug] of slugById) {
          const value = latest.get(id);
          const info = playerInfo.get(slug);
          if (info && typeof value === "number") info.value = value;
        }
      }
      players = Array.from(playerInfo.values()).sort(
        (a, b) => a.overall_rank - b.overall_rank,
      );
    }
  }

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          {fallbackBanner && (
            <p
              role="status"
              className="mb-6 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
            >
              <span className="font-medium text-ink">Heads up:</span> No{" "}
              {fallbackBanner.requested} data available for{" "}
              {format?.display_name ?? "this format"}. Showing {fallbackBanner.actual} data instead.
            </p>
          )}
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">Tools</p>
          <h1 className="text-4xl font-semibold tracking-tight">FAAB Calculator</h1>
          <p className="mt-3 text-ink-muted">
            Type in the player you are bidding on, your remaining FAAB budget, and how badly you
            need the position. We recommend a bid range using market value and need-weighted
            heuristics.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <FaabForm
          players={players}
          formatName={format?.display_name ?? "default format"}
          rankingsSourceName={rankingsSourceName}
          valueSourceName={valueSourceName}
        />
      </div>
    </main>
  );
}
