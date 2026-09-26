import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActiveFormats } from "@/lib/source";
import { resolveFormatSlug } from "@/lib/preferences";
import { formatPhrase, type RankingFormat } from "@/lib/rankings-formats";
import { pageShareMetadata } from "@/lib/page-og";
import { itemListJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { formatEastern } from "@/lib/datetime";
import { IDP_POSITIONS, POSITIONS, SITE, positionHeading, positionNoun } from "@/lib/site";
import { loadRankerSiteStats } from "@/lib/ranking-boards/community-state";
import { loadRankingBuilderSettings } from "@/lib/ranking-boards/settings";
import {
  loadCommunityFormatRow,
  loadCommunityRankings,
  type CommunityRankingRow,
} from "@/lib/ranking-boards/community-page-data";
import {
  communityGroupHeading,
  communityMovement,
  communityPageState,
  sortCommunityGroups,
  strengthPercent,
  type CommunityPageState,
} from "@/lib/ranking-boards/community-view";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { ProgressBar } from "@/components/manager-pulse/progress-bar";
import { PositionChip } from "@/components/position-chip";
import { PlayerHeadshot } from "@/components/player-headshot";

/**
 * /rankings/community (Beacon Ranker plan, sections 9 and 13.8).
 *
 * Every counted Beacon Ranker board in a format merged head to head into one
 * ranking by the nightly build (lib/community-rankings/). This page only reads
 * the result. No board, name or account is ever shown, because the tables hold
 * none.
 *
 * One page for every format, chosen by `?format=`. The rankings middleware
 * redirect that turns `?format=` into /rankings/<slug> skips this path
 * (lib/rankings-format-redirect.ts). With no `?format=`, the page opens on the
 * first PUBLISHED format, so its canonical is stable for crawlers; with no
 * format published, on the reader's own format.
 *
 * A format below the threshold renders honestly ("boards from 12 of the 25
 * people needed so far"), lists no players, and is noindex. The threshold
 * counts people, not boards: one reader with five boards is one opinion.
 */

export const dynamic = "force-dynamic";

type SearchParams = {
  format?: string | string[];
  pos?: string | string[];
};

type PageProps = { searchParams: Promise<SearchParams> };

type CommunityFormat = RankingFormat & { id: string };

const POSITION_ORDER: readonly string[] = [...POSITIONS, ...IDP_POSITIONS];

const LINK =
  "font-semibold text-ink underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Resolved = {
  formats: CommunityFormat[];
  format: CommunityFormat | null;
  /** The format the bare URL opens on: the first published one, if any. */
  defaultSlug: string | null;
  publishedSlugs: string[];
  state: CommunityPageState;
  builtAt: string | null;
};

/** Shared by generateMetadata and the page, so both agree on the format. */
const resolvePage = cache(async (rawFormat: string | undefined): Promise<Resolved> => {
  const supabase = await createClient();
  const [activeFormats, stats, settings] = await Promise.all([
    getActiveFormats(supabase),
    loadRankerSiteStats().catch(() => null),
    loadRankingBuilderSettings(createAdminClient()),
  ]);
  const formats = activeFormats as unknown as CommunityFormat[];
  const publishedSlugs = formats
    .map((f) => f.slug)
    .filter((slug) => stats?.publishedFormatSlugs.includes(slug));
  const defaultPublished = publishedSlugs[0] ?? null;

  const requested = rawFormat?.trim().toLowerCase();
  let format = requested ? (formats.find((f) => f.slug === requested) ?? null) : null;
  if (!format && defaultPublished) {
    format = formats.find((f) => f.slug === defaultPublished) ?? null;
  }
  if (!format) {
    // resolveFormatSlug only reads (URL, account, cookie, default); it never saves.
    const reader = await resolveFormatSlug(supabase, undefined);
    format = formats.find((f) => f.slug === reader.slug) ?? formats[0] ?? null;
  }

  const row = format ? await loadCommunityFormatRow(format.id) : null;
  return {
    formats,
    format,
    defaultSlug: defaultPublished,
    publishedSlugs,
    state: communityPageState(row, settings.community.minBoardsToPublish),
    builtAt: row?.built_at ?? null,
  };
});

const TITLE = "Community Fantasy Football Rankings";
const DESCRIPTION =
  "Fantasy football rankings built from every saved Beacon Ranker board in a format, merged head to head into one list. No single board is ever shown.";

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const resolved = await resolvePage(first(params.format));
  const published = resolved.state.kind === "published" && resolved.format;
  const isDefault = !resolved.format || resolved.format.slug === resolved.defaultSlug;
  const path =
    published && !isDefault
      ? `/rankings/community?format=${resolved.format!.slug}`
      : "/rankings/community";
  const title = published
    ? `${formatPhrase(resolved.format!)} ${TITLE}`
    : TITLE;
  return {
    title,
    description: DESCRIPTION,
    // A noindex page gets no canonical: pointing it at another URL would ask
    // a crawler to treat a page we asked it not to index as a copy of one.
    ...(published ? { alternates: { canonical: path } } : {}),
    robots: published ? { index: true, follow: true } : { index: false, follow: true },
    ...pageShareMetadata({
      key: "community-rankings",
      title,
      description: DESCRIPTION,
      path,
    }),
  };
}

export default async function CommunityRankingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const resolved = await resolvePage(first(params.format));
  const { format, state } = resolved;

  const rows =
    state.kind === "published" && format ? await loadCommunityRankings(format.id) : [];
  const positionsPresent = POSITION_ORDER.filter((p) => rows.some((r) => r.position === p));
  const rawPos = first(params.pos)?.toUpperCase();
  const pos = rawPos && positionsPresent.includes(rawPos) ? rawPos : null;
  const shown = pos
    ? rows.filter((r) => r.position === pos).sort((a, b) => a.positionRank - b.positionRank)
    : rows;

  const groups =
    state.kind === "published"
      ? sortCommunityGroups(state.groups).filter((g) => shown.some((r) => r.groupKey === g))
      : [];
  // Rows whose group the format row did not name still belong on the page.
  for (const r of shown) if (!groups.includes(r.groupKey)) groups.push(r.groupKey);

  const phrase = format ? formatPhrase(format) : "this format";
  const jsonLd =
    shown.length > 0
      ? itemListJsonLd(
          shown.map((r, i) => ({
            position: i + 1,
            url: `${SITE.url}/players/${r.slug}`,
            name: r.name,
          })),
        )
      : null;

  return (
    <main id="main">
      {jsonLd ? (
        <script
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      ) : null}
      <PageBody>
        <PageMasthead
          eyebrow="Rankings"
          title="Community fantasy football rankings"
          description={`Every saved Beacon Ranker board in ${phrase} merged head to head into one ranking, rebuilt nightly. No single board is ever shown, and nobody who built one is named.`}
          stats={[
            { label: "Boards counted", value: String(state.boards), accent: "cyan" },
            {
              label: "Players listed",
              value: state.kind === "published" ? String(state.playersListed) : "0",
            },
            {
              label: "Last rebuilt",
              value: resolved.builtAt ? formatEastern(resolved.builtAt) : "Not built yet",
              accent: "plain",
            },
          ]}
          actions={
            <Link
              href="/tools/custom-rankings"
              className="inline-flex min-h-11 items-center rounded-full border border-brand-purple/50 bg-brand-purple/10 px-4 text-sm font-semibold text-ink hover:bg-brand-purple/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Build your own rankings
            </Link>
          }
        />

        <FormatPicker
          formats={resolved.formats}
          currentSlug={format?.slug ?? null}
          publishedSlugs={resolved.publishedSlugs}
        />

        {state.kind === "building" ? (
          <BuildingState
            phrase={phrase}
            boards={state.boards}
            people={state.people}
            needed={state.needed}
          />
        ) : (
          <>
            {positionsPresent.length > 1 ? (
              <PositionFilter
                formatSlug={format?.slug ?? ""}
                positions={positionsPresent}
                current={pos}
              />
            ) : null}
            {groups.length > 1 ? (
              <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-muted">
                Nobody has ranked these groups against each other yet, so they are
                shown separately rather than in one invented order.
              </p>
            ) : null}
            {shown.length === 0 ? (
              <p className="mt-8 text-sm text-ink-muted">
                The community board for {phrase} could not be read just now. Try
                again in a minute.
              </p>
            ) : (
              groups.map((group) => (
                <GroupTable
                  key={group}
                  group={group}
                  single={groups.length === 1}
                  phrase={phrase}
                  pos={pos}
                  rows={shown.filter((r) => r.groupKey === group)}
                />
              ))
            )}
          </>
        )}
      </PageBody>
    </main>
  );
}

function FormatPicker({
  formats,
  currentSlug,
  publishedSlugs,
}: {
  formats: CommunityFormat[];
  currentSlug: string | null;
  publishedSlugs: string[];
}) {
  if (formats.length === 0) return null;
  return (
    <nav aria-labelledby="community-format-heading" className="mt-8">
      <h2
        id="community-format-heading"
        className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        Format
      </h2>
      <ul role="list" className="mt-3 flex flex-wrap gap-2">
        {formats.map((f) => {
          const current = f.slug === currentSlug;
          const published = publishedSlugs.includes(f.slug);
          return (
            <li key={f.slug}>
              <Link
                href={`/rankings/community?format=${f.slug}`}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  current
                    ? "border-brand-purple bg-brand-purple/15 font-semibold text-ink"
                    : "border-line bg-surface text-ink-muted hover:border-line-accent hover:text-ink"
                }`}
              >
                {formatPhrase(f)}
                {published ? null : (
                  <span className="ml-1.5 text-xs text-ink-subtle">(not enough boards yet)</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function PositionFilter({
  formatSlug,
  positions,
  current,
}: {
  formatSlug: string;
  positions: string[];
  current: string | null;
}) {
  const pill = (active: boolean) =>
    `inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
      active
        ? "border-brand-cyan bg-brand-cyan/10 font-semibold text-ink"
        : "border-line bg-surface text-ink-muted hover:border-line-accent hover:text-ink"
    }`;
  return (
    <nav aria-labelledby="community-position-heading" className="mt-6">
      <h2
        id="community-position-heading"
        className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        Position
      </h2>
      <ul role="list" className="mt-3 flex flex-wrap gap-2">
        <li>
          <Link
            href={`/rankings/community?format=${formatSlug}`}
            aria-current={current === null ? "page" : undefined}
            className={pill(current === null)}
          >
            All
          </Link>
        </li>
        {positions.map((p) => (
          <li key={p}>
            <Link
              href={`/rankings/community?format=${formatSlug}&pos=${p}`}
              aria-current={current === p ? "page" : undefined}
              className={pill(current === p)}
            >
              {p}
              {positionNoun(p).toUpperCase() !== p ? (
                <span className="sr-only"> ({positionNoun(p, "plural")})</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BuildingState({
  phrase,
  boards,
  people,
  needed,
}: {
  phrase: string;
  boards: number;
  people: number;
  needed: number;
}) {
  return (
    <section
      aria-labelledby="community-building-heading"
      className="mt-10 max-w-2xl rounded-card border border-line bg-surface p-5"
    >
      <h2 id="community-building-heading" className="text-xl font-semibold tracking-tight">
        Not enough people ranking {phrase} yet
      </h2>
      <p id="community-building-count" className="mt-3 text-sm leading-relaxed text-ink-muted">
        Boards from {people} of the {needed} people needed so far ({boards}{" "}
        {boards === 1 ? "board" : "boards"} counted). The community board for this
        format appears once {needed} different people each have a board that
        counts, and until then no players are listed here.
      </p>
      <ProgressBar
        className="mt-4"
        done={people}
        failed={0}
        total={needed}
        ariaLabelledBy="community-building-count"
        valueText={`${people} of ${needed} people`}
      />
      <p className="mt-4 text-sm">
        <Link href="/tools/custom-rankings" className={LINK}>
          Build yours to help
        </Link>
      </p>
    </section>
  );
}

function GroupTable({
  group,
  single,
  phrase,
  pos,
  rows,
}: {
  group: string;
  single: boolean;
  phrase: string;
  pos: string | null;
  rows: CommunityRankingRow[];
}) {
  const headingId = `community-group-${group}`;
  const heading = pos
    ? `${positionHeading(pos)} in ${phrase}`
    : single
      ? `${phrase} community rankings`
      : communityGroupHeading(group);
  const strengths = rows.map((r) => r.strength);
  const min = Math.min(...strengths);
  const max = Math.max(...strengths);
  const rankLabel = pos ? `${positionHeading(pos, "singular")} rank` : "Rank";

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="text-2xl font-semibold tracking-tight">
        {heading}
      </h2>
      <div className="mt-4 overflow-hidden rounded-card border border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {heading}. Rank, movement since the last rebuild, player, team, how many
            boards ranked him, and strength, the fitted score behind the order.
          </caption>
          <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="w-14 py-3 pl-4 pr-2 text-center">
                {rankLabel}
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                Player
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center sm:table-cell">
                Team
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center sm:table-cell">
                Movement
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center sm:table-cell">
                Boards
              </th>
              <th scope="col" className="py-3 pl-2 pr-4 text-right sm:w-48">
                Strength
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const rank = pos ? r.positionRank : r.overallRank;
              return (
                <tr key={r.playerId}>
                  <th
                    scope="row"
                    className="py-3 pl-4 pr-2 text-center font-mono font-normal tabular-nums text-ink"
                  >
                    {rank}
                    {pos ? (
                      <span className="block text-[11px] text-ink-subtle">
                        {r.overallRank} overall
                      </span>
                    ) : null}
                  </th>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <PlayerHeadshot
                        sleeperId={r.sleeperId}
                        position={r.position}
                        name=""
                        size={32}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link
                            href={`/players/${r.slug}`}
                            className="inline-flex min-h-11 items-center font-medium text-ink hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-0"
                          >
                            {r.name}
                          </Link>
                          <PositionChip position={r.position} />
                        </div>
                        {/* Below sm the Team, Movement and Boards columns fold into
                            this second line, so no figure is lost on a phone. */}
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted sm:hidden">
                          <span>{r.team ?? "Free agent"}</span>
                          <MovementText previous={r.previousRank} current={r.overallRank} />
                          <span className="text-ink-subtle">on {r.boardsCount} {r.boardsCount === 1 ? "board" : "boards"}</span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 text-center text-ink-muted sm:table-cell">
                    {r.team ?? "Free agent"}
                  </td>
                  <td className="hidden px-3 py-3 text-center sm:table-cell">
                    <MovementText previous={r.previousRank} current={r.overallRank} />
                  </td>
                  <td className="hidden px-3 py-3 text-center text-ink-subtle sm:table-cell">
                    on {r.boardsCount} {r.boardsCount === 1 ? "board" : "boards"}
                  </td>
                  <td className="py-3 pl-2 pr-4">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        aria-hidden="true"
                        className="hidden h-2 w-24 overflow-hidden rounded-full bg-base sm:block"
                      >
                        <span
                          className="block h-full rounded-full bg-beacon"
                          style={{ width: `${strengthPercent(r.strength, min, max)}%` }}
                        />
                      </span>
                      <span className="font-mono tabular-nums text-ink">
                        {r.strength.toFixed(1)}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Movement in colour AND words: "up 3", "down 2", "new", "same". */
function MovementText({ previous, current }: { previous: number | null; current: number }) {
  const m = communityMovement(previous, current);
  if (m.kind === "up" || m.kind === "down") {
    const Icon = m.kind === "up" ? ArrowUp : ArrowDown;
    return (
      <span
        className={`inline-flex items-center gap-1 ${
          m.kind === "up" ? "text-signal-positive" : "text-signal-warning"
        }`}
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {m.words}
        <span className="sr-only"> since the last rebuild</span>
      </span>
    );
  }
  return (
    <span className={m.kind === "new" ? "text-brand-cyan" : "text-ink-muted"}>
      {m.words}
      <span className="sr-only">
        {m.kind === "new" ? ", not listed at the last rebuild" : " as the last rebuild"}
      </span>
    </span>
  );
}
