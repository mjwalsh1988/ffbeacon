import type { Metadata } from "next";
import { Suspense } from "react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pageShareMetadata } from "@/lib/page-og";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { getActiveFormats, getAvailableSources } from "@/lib/source";
import { isBoardScope } from "@/lib/ranking-boards";
import { loadRankingBuilderSettings } from "@/lib/ranking-boards/settings";
import {
  latestAccountRunBoardId,
  loadAccountRun,
  loadGuestRun,
  type LoadedRun,
} from "@/lib/ranking-boards/run-store";
import { buildRunPayload, type RunPayload } from "@/lib/ranking-boards/run-payload";
import { readGuestId } from "@/lib/ranking-boards/guest";
import { loadRankerSiteStats } from "@/lib/ranking-boards/community-state";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead, type MastheadChip } from "@/components/app-shell/page-masthead";
import { SectionLoadingCard } from "@/components/section-loading-card";
import { RankerApp } from "./ranker-app";
import { WrittenSections } from "./written-sections";
import type { WizardBoard } from "./types";

const PATH = "/tools/custom-rankings";
// Keywords first and the brand second, the Trade Calculator split (plan 4).
// Absolute, because the site template would add a second "| FF Beacon".
const META_TITLE = "Custom Fantasy Football Rankings Builder | Beacon Ranker by FF Beacon";
const SHARE_TITLE = "Custom Fantasy Football Rankings Builder";
const META_DESCRIPTION =
  "Make your own fantasy football rankings by ranking players head to head, two at a time. Custom rankings for any format, with tiers, IDP and a free share link.";

export const metadata: Metadata = {
  title: { absolute: META_TITLE },
  description: META_DESCRIPTION,
  alternates: { canonical: PATH },
  ...pageShareMetadata({
    key: "custom-rankings",
    title: SHARE_TITLE,
    description: META_DESCRIPTION,
    path: PATH,
  }),
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; claim?: string }>;
}) {
  const params = await searchParams;
  const stats = await loadRankerSiteStats();

  const chips: MastheadChip[] = [
    { label: "Free", tone: "cyan" },
    { label: "Tiers and IDP", tone: "purple" },
  ];

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            webApplicationJsonLd({
              name: "Beacon Ranker: Custom Fantasy Football Rankings Builder",
              description: META_DESCRIPTION,
              url: PATH,
              category: "SportsApplication",
            }),
          ),
        }}
      />
      <PageBody width="tool">
        <PageMasthead
          eyebrow="Tools"
          title="Build your own fantasy football rankings"
          description="Beacon Ranker asks you about two players at a time and builds your custom rankings from the answers. Start from FF Beacon's rankings or another source, draw tiers, and share the board."
          chips={chips}
          stats={[
            { label: "Boards built", value: stats.boardsBuilt.toLocaleString("en-US"), accent: "cyan" },
            { label: "Players ranked", value: stats.playersRanked.toLocaleString("en-US"), accent: "purple" },
            ...(stats.communityBoards > 0
              ? [
                  {
                    label: "In community rankings",
                    value: stats.communityBoards.toLocaleString("en-US"),
                    accent: "plain" as const,
                  },
                ]
              : []),
          ]}
        />
        <div className="mt-8">
          <Suspense fallback={<SectionLoadingCard section="Rankings builder" message="Loading your boards and the rankings to start from" />}>
            <Builder
              boardParam={params.board}
              claim={params.claim === "1"}
              publishedFormatSlugs={stats.publishedFormatSlugs}
            />
          </Suspense>
        </div>
        <Written />
      </PageBody>
    </main>
  );
}

async function Written() {
  const settings = await loadRankingBuilderSettings(createAdminClient());
  return (
    <div className="mt-12">
      <WrittenSections
        winsBeforePrompt={settings.builder.winsBeforePrompt}
        guestCapMulti={settings.guests.capMulti}
        guestCapSingle={settings.guests.capSingle}
        retentionHours={settings.guests.retentionHours}
        defaultDepthMulti={settings.builder.defaultDepthMulti}
        defaultDepthSingle={settings.builder.defaultDepthSingle}
      />
    </div>
  );
}

async function Builder({
  boardParam,
  claim,
  publishedFormatSlugs,
}: {
  boardParam: string | undefined;
  claim: boolean;
  publishedFormatSlugs: string[];
}) {
  const supabase = await createClient();
  const admin = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const presetBoardId = boardParam && UUID_RE.test(boardParam) ? boardParam : null;

  // The resolved source and format are only READ here, as the wizard's
  // starting point. Nothing on this page writes them back (plan 5.1).
  const [settings, formats, registry, sourcePref, formatPref, guestId] = await Promise.all([
    loadRankingBuilderSettings(admin),
    getActiveFormats(supabase),
    getAvailableSources(supabase),
    resolveSourceSlug(supabase, undefined),
    resolveFormatSlug(supabase, undefined),
    readGuestId(),
  ]);

  let run: LoadedRun | null = null;
  let boards: WizardBoard[] = [];
  if (user) {
    // With a board named in the URL its run loads in the same wave.
    const [boardRows, latest, presetRun] = await Promise.all([
      supabase
        .from("user_ranking_boards")
        .select("id, name, scope, includes_defenders, format_config_id, user_ranking_board_players(count)")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }),
      presetBoardId ? Promise.resolve(presetBoardId) : latestAccountRunBoardId(supabase, user.id),
      presetBoardId && !claim ? loadAccountRun(supabase, presetBoardId) : Promise.resolve(null),
    ]);
    boards = (boardRows.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      scope: isBoardScope(row.scope) ? row.scope : "overall",
      includesDefenders: row.includes_defenders,
      formatSlug: formats.find((f) => f.id === row.format_config_id)?.slug ?? null,
      playerCount:
        (row.user_ranking_board_players as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
    }));
    if (presetRun) run = presetRun;
    else if (latest && !claim && !presetBoardId) run = await loadAccountRun(supabase, latest);
  } else if (guestId) {
    run = await loadGuestRun(admin, guestId);
  }

  let payload: RunPayload | null = null;
  if (run) {
    payload = await buildRunPayload(run, settings, {
      communityPublished: publishedFormatSlugs.includes(run.setup.meta.formatSlug),
    });
  }

  const rankingSources = registry
    .filter((s) => s.data_type.includes("rankings"))
    .map((s) => ({
      slug: s.slug,
      displayName: s.display_name,
      supportedFormatSlugs: s.supported_format_slugs,
    }));

  return (
    <RankerApp
      initialPayload={payload}
      signedIn={Boolean(user)}
      formats={formats.map((f) => ({
        slug: f.slug,
        display_name: f.display_name,
        league_type: f.league_type,
        scoring_type: f.scoring_type,
        is_superflex: f.is_superflex,
        display_order: f.display_order,
      }))}
      sources={rankingSources}
      defaultSourceSlug={sourcePref.slug}
      defaultFormatSlug={formatPref.slug}
      limits={{
        defaultDepthMulti: settings.builder.defaultDepthMulti,
        defaultDepthSingle: settings.builder.defaultDepthSingle,
        maxDepth: settings.builder.maxDepth,
        capMulti: settings.guests.capMulti,
        capSingle: settings.guests.capSingle,
        retentionHours: settings.guests.retentionHours,
      }}
      boards={boards}
      presetBoardId={presetBoardId}
      hasGuestBoard={!user && Boolean(run)}
      claim={claim && Boolean(user) && Boolean(guestId)}
      publishedFormatSlugs={publishedFormatSlugs}
    />
  );
}
