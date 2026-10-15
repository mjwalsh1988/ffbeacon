import type { Metadata } from "next";
import Link from "next/link";
import { SITE, positionHeading, positionNoun, IDP_POSITIONS, type IdpPosition } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { pageShareMetadata } from "@/lib/page-og";
import { nflTeamName } from "@/lib/nfl-teams";
import { IDP_PRESETS } from "@/lib/idp/scoring-presets";
import { loadIdpRankingsCached, type IdpRankingRow, type IdpRankings } from "@/lib/idp/rankings";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead, type MastheadChip } from "@/components/app-shell/page-masthead";
import { Panel } from "@/components/dashboard-panel";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { SectionNav, type SectionNavItem } from "@/components/season-pulse/section-nav";

/**
 * /rankings/idp
 *
 * Every defensive lineman, linebacker and defensive back ranked for the rest
 * of the season, under Sleeper's default IDP scoring. The data is
 * lib/idp/rankings.ts, which is the Beacon Ranker's defender seed; this page
 * adds no model.
 *
 * A static route, so it wins over the (board)/[format] segment without any
 * change to the format boards. No cookies are read, so the page caches.
 *
 * THE STATED EXCEPTION TO SOURCE AND FORMAT SYNC. No value source prices a
 * defender, so there is no source or format to follow, and the page says so in
 * its method panel rather than showing a value column.
 *
 * Plan of record: docs/seo-audit/gsc-growth-plan-2026-10-15.md, section 5.3.
 */

export const revalidate = 3600;

const TITLE = "IDP Rankings for Fantasy Football: DL, LB and DB";
const DESCRIPTION =
  "Rest-of-season IDP rankings for every defensive lineman, linebacker and defensive back, projected under Sleeper's default IDP scoring, with last season's finish and snap share, and a game log for every player.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/rankings/idp" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  ...pageShareMetadata({ key: "rankings-idp", title: TITLE, description: DESCRIPTION, path: "/rankings/idp" }),
};

/** "defensive-linemen", "linebackers", "defensive-backs": the plural noun from
 * lib/site.ts, so the anchors can never disagree with the headings. */
function sectionId(position: IdpPosition): string {
  return positionNoun(position, "plural").replace(/ /g, "-");
}

const LINK_CLASS = "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";

const FAQ: FaqAccordionItem[] = [
  {
    question: "What is IDP in fantasy football?",
    answer:
      "IDP stands for individual defensive players. Instead of, or as well as, a whole team defense, an IDP league starts defensive linemen, linebackers and defensive backs as players in their own right, and scores them on tackles, sacks, interceptions and the other plays they make.",
  },
  {
    question: "What scoring are these rankings in?",
    answer:
      "Sleeper's default IDP scoring, the settings a new Sleeper league starts with. Every projection and every one of last season's points on this page is worked out under it, so a league with a heavier tackle or big-play setting will order some players differently.",
  },
  {
    question: "How often do these rankings update?",
    answer:
      "The projections behind the order refresh daily, and last season's finishes are rebuilt nightly. The page itself is rebuilt at most once an hour.",
  },
  {
    question: "Why is there no dynasty or trade value column?",
    answer:
      "None of the value sources we carry publishes a price for a defender, so there is no trade value to show. The order here is projected points for the rest of the season, with last season's record beside each name.",
  },
  {
    question: "Where do I see a player's game log?",
    answer:
      "Every name on this page links to that player's profile, which has his week by week game log, his snap share and his finishes in earlier seasons.",
  },
];

/** The weights the method panel quotes, read from the preset itself. */
function scoringSentence(): string {
  const s = IDP_PRESETS.idp123;
  return `Sleeper's default IDP scoring pays ${s.idp_tkl_solo} points for a solo tackle, ${s.idp_tkl_ast} for an assisted tackle, ${s.idp_tkl_loss} for a tackle for loss, ${s.idp_sack} for a sack, ${s.idp_int} for an interception, ${s.idp_pass_def} for a pass defended, ${s.idp_ff} for a forced fumble and ${s.idp_def_td} for a defensive touchdown.`;
}

/** "182.0 pts, DL22 of 409", with the position spelled out for the ear inside
 * the same element, as the defender profile does it. */
function LastSeason({ row }: { row: IdpRankingRow }) {
  if (row.lastSeasonPoints === null) return <>No record</>;
  const points = `${row.lastSeasonPoints.toFixed(1)} pts`;
  if (!row.lastSeasonFinish) return <>{points}</>;
  return (
    <>
      {points}, {row.position}
      {row.lastSeasonFinish.finish}
      <span className="sr-only"> among {positionNoun(row.position, "plural")},</span> of{" "}
      {row.lastSeasonFinish.of}
    </>
  );
}

function TeamText({ team }: { team: string | null }) {
  if (!team) return <>Free agent</>;
  const name = nflTeamName(team);
  return (
    <>
      {team}
      {name && <span className="sr-only"> ({name})</span>}
    </>
  );
}

function PositionTable({ position, rows }: { position: IdpPosition; rows: IdpRankingRow[] }) {
  const plural = positionHeading(position, "plural");
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{`${plural}, ranked by projected rest-of-season IDP points`}</caption>
        <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="w-14 py-3 pl-4 pr-2 text-center">
              Rank
            </th>
            <th scope="col" className="px-3 py-3">
              Player
            </th>
            <th scope="col" className="hidden px-3 py-3 sm:table-cell">
              Team
            </th>
            <th scope="col" className="px-3 py-3 text-right">
              Projected
            </th>
            <th scope="col" className="hidden px-3 py-3 text-right sm:table-cell">
              Last season
            </th>
            <th scope="col" className="hidden py-3 pl-3 pr-4 text-right sm:table-cell">
              Snap share
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.playerId}>
              <td className="w-14 py-3 pl-4 pr-2 text-center font-mono tabular-nums text-ink-muted">
                {row.positionRank}
              </td>
              <th scope="row" className="px-3 py-3 text-left font-normal">
                <Link
                  href={`/players/${row.slug}`}
                  className="inline-flex min-h-11 items-center font-medium text-ink hover:text-brand-cyan hover:underline"
                >
                  {row.name}
                </Link>
                {/* Phone layout: the team, stacked under the name, because its
                    own column is folded away below sm. */}
                <span className="block text-xs text-ink-subtle sm:hidden">
                  <TeamText team={row.team} />
                </span>
              </th>
              <td className="hidden px-3 py-3 text-ink-muted sm:table-cell">
                <TeamText team={row.team} />
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-ink">
                {row.projectedRos === null ? (
                  <span className="font-sans text-ink-subtle">No projection</span>
                ) : (
                  row.projectedRos.toFixed(1)
                )}
                {/* Phone layout: last season and snap share stacked under the
                    projection, with their column names, so no figure is lost. */}
                <span className="mt-1 block font-sans text-xs text-ink-subtle sm:hidden">
                  Last season: <LastSeason row={row} />
                </span>
                <span className="block font-sans text-xs text-ink-subtle sm:hidden">
                  Snap share: {row.avgSnapPct === null ? "No snaps" : `${row.avgSnapPct}%`}
                </span>
              </td>
              <td className="hidden px-3 py-3 text-right tabular-nums text-ink-muted sm:table-cell">
                <LastSeason row={row} />
              </td>
              <td className="hidden py-3 pl-3 pr-4 text-right font-mono tabular-nums text-ink-muted sm:table-cell">
                {row.avgSnapPct === null ? <span className="font-sans">No snaps</span> : `${row.avgSnapPct}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function loadSafely(): Promise<IdpRankings | null> {
  try {
    return await loadIdpRankingsCached();
  } catch (error) {
    console.error("[rankings/idp] load failed", error);
    return null;
  }
}

export default async function IdpRankingsPage() {
  const data = await loadSafely();
  const hasRows = data !== null && data.rows.length > 0;
  const anyProjected = data?.rows.some((r) => r.basis === "projected") ?? false;
  const liveWeek = data && data.currentWeek >= 1 && data.currentWeek <= 18 ? data.currentWeek : null;

  // The engine is named only when it actually ordered someone on the board:
  // out of season the resolved source is "none", which is not a name.
  const chips: MastheadChip[] = [
    ...(data?.season ? [{ label: `${data.season} season`, tone: "cyan" as const }] : []),
    ...(liveWeek ? [{ label: `Week ${liveWeek}`, tone: "plain" as const }] : []),
    { label: "Sleeper default IDP scoring", tone: "plain" },
    ...(anyProjected && data && data.projectionSourceDisplay !== "none"
      ? [{ label: `Projected by ${data.projectionSourceDisplay}`, tone: "purple" as const }]
      : []),
  ];

  const sections: SectionNavItem[] = [
    ...(hasRows
      ? IDP_POSITIONS.map((position) => ({
          id: sectionId(position),
          title: positionHeading(position, "plural"),
          short: positionHeading(position, "plural"),
        }))
      : []),
    { id: "faq", title: "Questions, answered", short: "FAQ" },
  ];

  const canonical = `${SITE.url}/rankings/idp`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: TITLE,
      description: DESCRIPTION,
      url: canonical,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      author: authorJsonLd(),
    },
    faqPageJsonLd(FAQ),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Rankings", item: `${SITE.url}/rankings` },
        { "@type": "ListItem", position: 3, name: "IDP Rankings", item: canonical },
      ],
    },
  ];

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <PageBody flush>
        <PageMasthead
          eyebrow="Rankings"
          title="IDP fantasy football rankings"
          chips={chips}
          description={
            data?.basisText ?? "Defensive players ranked for the rest of the season under Sleeper's default IDP scoring."
          }
        />
      </PageBody>

      <PageColumns
        railLabel="Sections of this page"
        rail={
          <>
            <SectionNav items={sections} variant="rail" label="IDP rankings sections" />
            {/* Always visible, so the rail is never an empty landmark below xl,
                where the rail SectionNav is hidden. */}
            <Panel eyebrow="Rankings" title="More rankings" headingLevel={2}>
              <ul role="list" className="space-y-1 text-sm">
                <li>
                  <Link href="/rankings" className={`inline-flex min-h-11 items-center ${LINK_CLASS}`}>
                    Every rankings board
                  </Link>
                </li>
                <li>
                  <Link
                    href="/guides/idp-fantasy-football"
                    className={`inline-flex min-h-11 items-center ${LINK_CLASS}`}
                  >
                    IDP fantasy football guide
                  </Link>
                </li>
              </ul>
            </Panel>
          </>
        }
      >
        <SectionNav items={sections} variant="bar" label="IDP rankings sections" />

        <Panel eyebrow="Method" title="How this board is built" headingLevel={2}>
          <ul role="list" className="space-y-2.5 text-sm leading-relaxed text-ink-muted">
            <li>{scoringSentence()}</li>
            <li>
              No value source prices a defender, so there is no trade value column here; the board is projected points
              and last season&apos;s record.
            </li>
            <li>
              For how IDP leagues work and which defenders to target, read{" "}
              <Link href="/guides/idp-fantasy-football" className={LINK_CLASS}>
                the IDP guide
              </Link>
              .
            </li>
          </ul>
        </Panel>

        {hasRows && data ? (
          IDP_POSITIONS.map((position) => (
            <Panel
              key={position}
              id={sectionId(position)}
              eyebrow={data.byPosition[position].length > 0 ? `Top ${data.byPosition[position].length}` : "Rankings"}
              title={positionHeading(position, "plural")}
              headingLevel={2}
            >
              {data.byPosition[position].length > 0 ? (
                <PositionTable position={position} rows={data.byPosition[position]} />
              ) : (
                <p className="text-sm leading-relaxed text-ink-muted">
                  No {positionNoun(position, "plural")} have a projection or last season&apos;s points yet.
                </p>
              )}
            </Panel>
          ))
        ) : (
          <Panel eyebrow="Rankings" title="No defenders ranked yet" headingLevel={2}>
            <p className="text-sm leading-relaxed text-ink-muted">
              {data?.basisText ?? "The rankings could not be loaded just now. Try again in a few minutes."}
            </p>
          </Panel>
        )}

        <Panel id="faq" eyebrow="FAQ" title="IDP rankings questions, answered" headingLevel={2}>
          <FaqAccordion items={FAQ} />
        </Panel>
      </PageColumns>
    </main>
  );
}
