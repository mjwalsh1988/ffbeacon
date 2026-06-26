import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  resolveSourceForFormat,
  getAvailableSources,
  describeSource,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { loadFaabSettings } from "@/lib/faab/settings";
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
  // Settings are service-role-only (RLS); read them server-side with the admin
  // client, same as Signal Check. loadFaabSettings never throws and falls back
  // to safe code defaults, so the calculator renders even if the row is absent.
  // The three are independent, so resolve them in parallel.
  const [settings, formatResolution, sourceResolution] = await Promise.all([
    loadFaabSettings(createAdminClient()),
    resolveFormatSlug(supabase, params.format),
    resolveSourceSlug(supabase, params.source),
  ]);
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
  let valueSourceIsBeacon = false;
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
      valueSourceIsBeacon = valueHistoryResolution.source === "ffbeacon";
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
        // for older / non-Sleeper-resolved players - headshot falls back to
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
      <header className="relative overflow-hidden border-b border-line">
        {/* Beacon gradient accent bar pinned to the very top. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
          }}
        />
        {/* Soft ambient glow behind the headline. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[820px] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.16) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 75%)",
          }}
        />
        {/* Second cyan glow anchored bottom-right for depth. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 right-0 h-[320px] w-[480px]"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(34, 211, 238, 0.10) 0%, transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
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
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Tools
          </p>
          <h1
            aria-label="FAAB Calculator"
            className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            FAAB{" "}
            <span
              className="bg-clip-text text-transparent forced-colors:text-ink"
              style={{
                backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
              }}
            >
              Calculator
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
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
          valueSourceIsBeacon={valueSourceIsBeacon}
          settings={settings}
        />
      </div>
    </main>
  );
}
