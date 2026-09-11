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
import {
  loadFreshestRankingsGeneratedAt,
  loadRankingsBoardCached,
} from "@/lib/rankings-board";
import { isBestBall } from "@/lib/rankings-formats";
import { ALL_TERMS } from "@/lib/guides/fantasy-football-terms";

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

  // THE BOARD READ, CACHED (SEO-T978).
  //
  // /rankings/[format] is force-dynamic (the page reads cookies for source
  // preference and Discord membership above), so every request used to re-run
  // the full rankings + trends + value-history waterfall below. The freshest
  // rankings.generated_at is read first, cheaply (one row, the index migration
  // 0273 added), and folded into the cache key along with the resolved format
  // and sources: lib/rankings-board.ts has the full reasoning. Nothing
  // user-scoped crosses into the cached function; it reads through the
  // cookie-less anon client and takes only these already-resolved values.
  const freshestGeneratedAt = await loadFreshestRankingsGeneratedAt(supabase);
  const board = await loadRankingsBoardCached({
    formatConfigId: format.id,
    rankingsSource: rankingsResolution.source,
    valueHistorySource: valueHistoryResolution.source,
    generatedAt: freshestGeneratedAt,
  });

  const tableCadence = registry.find(
    (s) => s.slug === valueHistoryResolution.source,
  )?.update_cadence as "daily" | "weekly" | undefined;

  // Position filtering happens here, in memory, against the cached full board,
  // rather than as a query param on the cached read: the cache is keyed by
  // format and source only, so one cache entry serves every position filter.
  const rows: RankingsRow[] = (
    position ? board.rows.filter((r) => r.position === position) : board.rows
  ).map((r) => ({ ...r, cadence: tableCadence }));

  // Which glossary entries this format's own settings touch (SEO-T974).
  const glossaryLinks = glossaryLinksForFormat(format);

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

  // Freshest snapshot for this (format, source). Read inside the cached board
  // loader: one row, ordered by captured_at descending.
  const lastCapturedAt = board.lastCapturedAt;

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
            <GlossaryTermsNote links={glossaryLinks} />
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

/** Every glossary anchor id this module is allowed to link to. Built once
 *  from lib/guides/fantasy-football-terms.ts so a link never points at an id
 *  that file has renamed or dropped. */
const GLOSSARY_TERM_IDS = new Set(ALL_TERMS.map((t) => t.id));

type FormatGlossaryLink = { id: string; anchorText: string };

/**
 * Which glossary terms this format's own settings involve (SEO-T974).
 *
 * Every /rankings/[format] page shows a different subset, in a different
 * order, because it is read straight off the format's own columns: a
 * standard-scoring redraft page links only "standard scoring" and "redraft",
 * while a TE Premium superflex dynasty page links four terms. That is what
 * keeps the sentence GlossaryTermsNote builds from reading identically on
 * every one of the twelve pages.
 */
function glossaryLinksForFormat(format: {
  slug: string;
  league_type: string;
  scoring_type: string;
  is_superflex: boolean;
  te_premium_bonus: number | string | null;
}): FormatGlossaryLink[] {
  const candidates: FormatGlossaryLink[] = [];

  if (format.scoring_type === "ppr") {
    candidates.push({ id: "ppr", anchorText: "PPR scoring" });
  } else if (format.scoring_type === "half_ppr") {
    candidates.push({ id: "half-ppr", anchorText: "half PPR scoring" });
  } else if (format.scoring_type === "standard") {
    candidates.push({ id: "standard-scoring", anchorText: "standard scoring" });
  }

  if (Number(format.te_premium_bonus ?? 0) > 0) {
    candidates.push({ id: "te-premium", anchorText: "TE Premium" });
  }

  if (format.is_superflex) {
    candidates.push({ id: "superflex", anchorText: "superflex" });
  }

  if (isBestBall(format.slug)) {
    candidates.push({ id: "best-ball", anchorText: "best ball" });
  }

  if (format.league_type === "dynasty") {
    candidates.push({ id: "dynasty", anchorText: "dynasty leagues" });
  } else if (format.league_type === "redraft") {
    candidates.push({ id: "redraft", anchorText: "redraft leagues" });
  }

  return candidates.filter((c) => GLOSSARY_TERM_IDS.has(c.id));
}

/**
 * Inline links to the terms this format touches, each pointed at its own
 * anchor id on /guides/fantasy-football-terms rather than at the page as a
 * whole, since that is what lets a reader land straight on the definition
 * they need. Renders nothing when a format's settings match no known term.
 */
function GlossaryTermsNote({ links }: { links: FormatGlossaryLink[] }) {
  if (links.length === 0) return null;

  return (
    <p className="mt-3 max-w-2xl text-sm text-ink-muted">
      New to this format? Brush up on{" "}
      {links.map((link, i) => (
        <span key={link.id}>
          <Link
            href={`/guides/fantasy-football-terms#${link.id}`}
            className="text-brand-cyan underline-offset-4 hover:underline"
          >
            {link.anchorText}
          </Link>
          {i === links.length - 1
            ? ""
            : i === links.length - 2
              ? links.length > 2
                ? ", and "
                : " and "
              : ", "}
        </span>
      ))}{" "}
      in the fantasy football glossary.
    </p>
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
