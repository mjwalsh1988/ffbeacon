import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Database, Layers, Filter, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  resolveSourceForFormat,
  getAvailableSources,
  getActiveFormats,
  describeSource,
  reconcileFormatWithSource,
} from "@/lib/source";
import { RankingsTable, type RankingsRow } from "@/components/rankings-table";
import { ScrollToRankings } from "@/app/rankings/scroll-to-rankings";
import { POSITIONS } from "@/lib/site";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { isDiscordMember } from "@/lib/discord-membership";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { PageBody } from "@/components/app-shell/page-body";
import {
  PageMasthead,
  type MastheadChip,
  type MastheadStat,
} from "@/components/app-shell/page-masthead";
import { formatEasternShortDate } from "@/lib/datetime";

/**
 * The rankings board, shared by /rankings and /rankings/[format].
 *
 * Extracted so the two routes can differ in exactly the way that matters for search
 * (headline, title, meta description, canonical) while rendering byte-identical data,
 * filters, and banners. Previously the single /rankings page deliberately held one
 * stable h1 across every `?format=` combination, which meant the twelve formats were
 * twelve URLs Google could only read as near-duplicates of each other. Format now
 * lives in the path with its own copy; source stays a query param that canonicalizes
 * away, because a data source is a reader preference rather than something anyone
 * searches for.
 *
 * The caller decides the format. The hub resolves it through the usual preference
 * chain (URL, then DB, then cookie, then default); a format page takes it from the
 * path. Source is resolved by the caller too, so the header's source dropdown keeps
 * working identically on both.
 */


export interface RankingsViewProps {
  /** The format to render. Already decided by the caller. */
  formatSlug: string;
  /**
   * The reader's requested source, from the resolver chain. Null when no preference
   * resolves, in which case the source helpers fall back to the registry default.
   */
  requestedSourceSlug: string | null;
  /** Active position filter, or null for all positions. */
  position: string | null;
  /** Path the position filter links hang off ("/rankings" or "/rankings/{slug}"). */
  basePath: string;
  /** True when any filter param is present, so the page scrolls to the board. */
  hasActiveFilter: boolean;
  /** Area label above the title. Defaults to "Rankings". */
  eyebrow?: string;
  /** The board's name. Rendered as the page's h1 by PageMasthead. */
  title: string;
  intro: string;
  /** Optional "browse every format" grid, rendered by the hub only. */
  footerSlot?: ReactNode;
}

export async function RankingsView({
  formatSlug: requestedFormatSlug,
  requestedSourceSlug,
  position,
  basePath,
  hasActiveFilter,
  eyebrow = "Rankings",
  title,
  intro,
  footerSlot,
}: RankingsViewProps) {
  const supabase = await createClient();

  const [registry, allFormats] = await Promise.all([
    getAvailableSources(supabase),
    getActiveFormats(supabase),
  ]);

  // Reconcile (source, format): if the active source doesn't support this format,
  // fall through to a sensible substitute and surface a banner. Not persisted; it is
  // a read-time correction so the reader gets coherent data without losing saved
  // preferences elsewhere.
  const reconciled = reconcileFormatWithSource(
    registry,
    allFormats,
    requestedSourceSlug,
    requestedFormatSlug,
  );
  const formatSlug = reconciled.formatSlug;

  const { data: format } = await supabase
    .from("format_configs")
    .select(
      "id, slug, display_name, league_type, scoring_type, is_superflex, te_premium_bonus",
    )
    .eq("slug", formatSlug)
    .maybeSingle();

  if (!format) {
    return (
      <main id="main">
        <PageBody>
          <PageMasthead
            eyebrow="Rankings"
            title="Rankings"
            description="Format not found."
          />
        </PageBody>
      </main>
    );
  }

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

  // Rankings + value history + trends run in parallel; the join happens in memory.
  //
  // We intentionally do NOT pass .in("player_id", playerIds) on
  // player_value_history: with 400+ UUIDs the PostgREST GET URL silently exceeds the
  // fetch URL length limit and the request fails with "fetch failed", leaving the
  // page values-less. The (format_config_id, source) pair already bounds the result
  // to a few hundred rows, so the filter is unnecessary anyway.
  const rankingsQuery = supabase
    .from("rankings")
    .select(
      "overall_rank, position_rank, tier, players!inner(id, slug, first_name, last_name, position, team, status, external_ids)",
    )
    .eq("format_config_id", format.id)
    .eq("source", rankingsResolution.source ?? "__none__")
    // No season filter. lib/seed-rankings.ts derives the season from
    // currentNflSeason() and sweeps every other one, so the table holds
    // exactly one. Pinning a constant here is what used to risk this
    // reader and the writer drifting apart and silently serving a frozen
    // board, and it would also blank the page for the hours between the
    // March rollover and that night's write.
    .is("week", null)
    .order("overall_rank")
    .limit(500);

  const [rankingsResult, valuesResult, trendsResult] = await Promise.all([
    rankingsResolution.source
      ? position
        ? rankingsQuery.eq("players.position", position)
        : rankingsQuery
      : Promise.resolve({ data: [] as never }),
    valueHistoryResolution.source
      ? supabase
          .from("player_value_history")
          .select("player_id, value, captured_at")
          .eq("format_config_id", format.id)
          .eq("source", valueHistoryResolution.source)
          .order("captured_at", { ascending: false })
      : Promise.resolve({ data: [] as never }),
    valueHistoryResolution.source
      ? supabase
          .from("player_value_trends")
          .select(
            "player_id, change_7d, change_7d_pct, trend_7d, rank_change_7d, rank_7d_ago, show_trend_7d",
          )
          .eq("format_config_id", format.id)
          .eq("source", valueHistoryResolution.source)
      : Promise.resolve({ data: [] as never }),
  ]);

  const valueByPlayer = new Map<string, { value: number }>();
  for (const v of valuesResult.data ?? []) {
    if (valueByPlayer.has(v.player_id)) continue;
    valueByPlayer.set(v.player_id, { value: v.value });
  }
  const trendByPlayer = new Map<
    string,
    {
      change_7d: number | null;
      change_7d_pct: number | null;
      trend_7d: string | null;
      rank_change_7d: number | null;
      rank_7d_ago: number | null;
      show_trend_7d: boolean;
    }
  >();
  for (const t of trendsResult.data ?? []) {
    trendByPlayer.set(t.player_id, {
      change_7d: t.change_7d,
      change_7d_pct: t.change_7d_pct,
      trend_7d: t.trend_7d,
      rank_change_7d: t.rank_change_7d,
      rank_7d_ago: t.rank_7d_ago,
      show_trend_7d: t.show_trend_7d,
    });
  }

  const tableCadence = registry.find(
    (s) => s.slug === valueHistoryResolution.source,
  )?.update_cadence as "daily" | "weekly" | undefined;

  const rows: RankingsRow[] = (rankingsResult.data ?? []).map((r) => {
    const player = (
      r as unknown as {
        players: {
          id: string;
          slug: string;
          first_name: string;
          last_name: string;
          position: string;
          team: string | null;
          status: string;
          external_ids: Record<string, unknown> | null;
        };
      }
    ).players;
    const value = valueByPlayer.get(player.id);
    const trend = trendByPlayer.get(player.id);
    // Sleeper id lives on players.external_ids.sleeper. May be missing for older or
    // non-Sleeper-resolved players; the headshot component falls back to a position
    // badge in that case.
    const sleeperExt = player.external_ids?.sleeper;
    const sleeper_id =
      typeof sleeperExt === "string" && sleeperExt
        ? sleeperExt
        : typeof sleeperExt === "number"
          ? String(sleeperExt)
          : null;
    return {
      overall_rank: r.overall_rank,
      position_rank: r.position_rank,
      tier: r.tier ?? null,
      slug: player.slug,
      sleeper_id,
      name: `${player.first_name} ${player.last_name}`,
      position: player.position,
      team: player.team,
      status: player.status,
      value: value?.value ?? null,
      change_7d: trend?.change_7d ?? null,
      change_7d_pct: trend?.change_7d_pct ?? null,
      trend_7d: trend?.trend_7d ?? null,
      rank_change_7d: trend?.rank_change_7d ?? null,
      rank_7d_ago: trend?.rank_7d_ago ?? null,
      show_trend_7d: trend?.show_trend_7d ?? false,
      cadence: tableCadence,
    };
  });

  // Confirmed Discord members skip the invite: the hero button scrolls straight to
  // the board and the bottom CTA points at the rest of the toolkit.
  const isMember = await isDiscordMember();

  const positionHref = (pos?: string) =>
    pos ? `${basePath}?position=${pos}` : basePath;

  // The source label always comes from source_registry.display_name via
  // describeSource, never the raw slug.
  //
  // It names the VALUE source, not the rankings source. resolveSourceForFormat
  // runs once per table, so `rankings` and `player_value_history` can fall
  // through to different sources for the same format. The chip reads "Values
  // via X" and the "Updated" stat beside it is the freshest value snapshot, so
  // both have to describe the same table or the pair contradicts itself.
  const sourceLabel = valueHistoryResolution.source
    ? describeSource(registry, valueHistoryResolution.source)
    : "Not available";

  // Freshest snapshot in this pull. The value query is ordered by captured_at
  // descending, so the first row is the newest one we have.
  const lastCapturedAt = valuesResult.data?.[0]?.captured_at ?? null;

  const chips: MastheadChip[] = [
    // The source chip says what it is ("Values via ..."); the format chip is
    // just a name, so it says which kind of name it is.
    { label: `Format: ${format.display_name}`, icon: Layers, tone: "cyan" },
    { label: `Values via ${sourceLabel}`, icon: Database, tone: "purple" },
  ];

  const stats: MastheadStat[] = [
    {
      label: "Players ranked",
      value: rows.length.toLocaleString(),
      accent: "cyan",
    },
  ];
  if (lastCapturedAt) {
    stats.push({
      label: "Updated",
      value: formatEasternShortDate(lastCapturedAt),
      accent: "purple",
    });
  }

  return (
    <main id="main">
      <PageBody>
        {reconciled.fallback && (
          <p
            role="status"
            aria-live="polite"
            className="mb-4 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
          >
            <span className="font-medium text-ink">
              Switched to {reconciled.fallback.toName}
            </span>{" "}
            because {reconciled.fallback.sourceName} doesn{"'"}t provide values
            for {reconciled.fallback.fromName}.
          </p>
        )}
        {rankingsResolution.fellBack && rankingsResolution.source && (
          <p
            role="status"
            className="mb-4 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
          >
            <span className="font-medium text-ink">Heads up:</span> No{" "}
            {describeSource(registry, rankingsResolution.requested)} data
            available for {format.display_name}. Showing{" "}
            {describeSource(registry, rankingsResolution.source)} data instead.
          </p>
        )}

        <PageMasthead
          eyebrow={eyebrow}
          title={title}
          description={intro}
          chips={chips}
          stats={stats}
          actions={
            <>
              {/* Short labels on purpose: the hero shows two of these three
                  buttons at once, and the longer wording pushed the pair onto
                  two rows at phone width. */}
              <MemberHeroCta
                isMember={isMember}
                size="lg"
                memberMode="scroll"
                memberScrollTargetId="rankings-board"
                memberLabel="View Rankings"
                memberIcon="arrow-down"
                joinLabel="Join Discord"
              />
              <Link
                href="/tools"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Free Tools
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </>
          }
        >
          <SwitchFormatHint />
        </PageMasthead>

        <section
          id="rankings-board"
          aria-labelledby="rankings-board-heading"
          className="mt-6 scroll-mt-4"
        >
          {hasActiveFilter && (
            <ScrollToRankings
              key={`${formatSlug}-${position ?? "all"}-${rankingsResolution.source ?? "none"}`}
              targetId="rankings-board"
              headingId="rankings-board-heading"
            />
          )}
          <div className="mb-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              The board
            </p>
            <h2
              id="rankings-board-heading"
              className="text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              Every ranked player, in one sortable view.
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
              {rows.length.toLocaleString()} players in {format.display_name},
              sorted by current market value. Click any column header to
              re-sort, or open a player&apos;s row for the full breakdown.
            </p>
          </div>

          {/* Filter card. Icon chip plus label, stacking gracefully on mobile:
              icon + label on top, chips wrap below, every chip is 44px tall for
              touch. */}
          <div
            className="relative mb-5 overflow-hidden rounded-card border border-line bg-surface p-4 sm:p-5"
            style={{ boxShadow: "0 0 48px -40px rgba(168, 85, 247, 0.55)" }}
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-px"
              style={{
                backgroundImage:
                  "linear-gradient(180deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
              }}
            />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
                >
                  <Filter className="h-4 w-4" />
                </span>
                <p
                  id="position-filter-label"
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
                >
                  Filter by position
                </p>
              </div>
              <nav
                aria-labelledby="position-filter-label"
                className="flex flex-wrap gap-2 sm:flex-1"
              >
                <FilterLink
                  href={positionHref()}
                  active={!position}
                  label="All positions"
                />
                {POSITIONS.map((pos) => (
                  <FilterLink
                    key={pos}
                    href={positionHref(pos)}
                    active={position === pos}
                    label={pos}
                  />
                ))}
              </nav>
            </div>
          </div>

          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {rows.length === 0 ? (
              <p className="p-6 text-sm text-ink-muted">
                No ranking data for this format yet. Try a different format.
              </p>
            ) : (
              <RankingsTable
                key={position ?? "all"}
                rows={rows}
                positionFilter={position}
                valueIsBeacon={valueHistoryResolution.source === "ffbeacon"}
              />
            )}
          </div>
        </section>

        {footerSlot}
      </PageBody>

      <DiscordCtaSection
        eyebrow="Need help reading the board?"
        heading="Stuck on a ranking? Real people are a message away."
        body="Drop into our Discord for a free gut check on any player or tier from real fantasy managers, and the board updates automatically as new data comes in. Want to know what powers the FF Beacon number? Read about FF Beacon."
        isMember={isMember}
        memberHeading="Board in view. Put it to work in the tools."
        memberBody="You're already part of the crew, so we'll skip the invite. Carry these rankings into the rest of the free FF Beacon toolkit for trades, waivers, and drafts."
      />
    </main>
  );
}

function FilterLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      // Suppress the App Router's snap-to-top on navigation; ScrollToRankings owns
      // the scroll so a position click glides down to the board instead.
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-card border px-4 text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
        active
          ? "border-brand-purple/60 bg-brand-purple/15 text-ink shadow-[0_0_24px_-12px_rgba(168,85,247,0.65)]"
          : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * Sits inside the masthead and answers the question readers keep
 * asking: how do I see another format, and do you even publish them? Both are
 * already true and already shipped, they just live in a header control people
 * miss, especially on a phone where it hides behind the hamburger.
 *
 * The instructions differ by device because the control does. The breakpoint
 * matches site-header.tsx exactly: below md the toggles live in the navigation
 * drawer (components/app-shell/app-mobile-nav.tsx),
 * at md and up they live in the PreferencesMenu popover labelled "Values".
 * Only one sentence is in the DOM's accessibility tree at a time (Tailwind's
 * `hidden` sets display:none, which removes it from the tree as well as the
 * screen), so a screen reader hears the directions for the device in hand and
 * never both. No information is lost at either breakpoint; the same instruction
 * is simply worded for the control that is actually on screen.
 */
function SwitchFormatHint() {
  return (
    <div
      className="flex items-start gap-3 rounded-card border border-dashed border-line bg-surface px-4 py-3.5"
      style={{ boxShadow: "0 0 48px -40px rgba(34, 211, 238, 0.55)" }}
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Info className="h-4 w-4" />
      </span>
      <p className="min-w-0 flex-1 self-center text-sm leading-relaxed text-ink-muted">
        <span className="font-semibold text-ink">Play a different format?</span>{" "}
        Redraft, dynasty, superflex, and TE premium are all ranked already,
        updated daily.{" "}
        <span className="md:hidden">
          To switch, tap the menu button at the top left of the header, then
          choose a Format near the bottom of the menu.
        </span>
        <span className="hidden md:inline">
          To switch, open the Values button in the header, then choose a League
          format.
        </span>
      </p>
    </div>
  );
}
