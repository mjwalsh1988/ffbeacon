import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { findPublishedGuide } from "@/lib/guides/published";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { GuideShell } from "@/components/guides/guide-shell";
import { GuideToc } from "@/components/guides/guide-toc";
import { GuideSectionHeader, GuideSubheading } from "@/components/guides/guide-section-header";
import { FaqAccordion } from "@/components/faq-accordion";
import { IDP_GUIDE_LESSONS, buildIdpFaq } from "@/lib/guides/idp-fantasy-football";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { DataTable, Td, Th } from "@/components/chart-kit";
import { isDiscordMember } from "@/lib/discord-membership";
import { currentNflSeason } from "@/lib/nfl-season";
import { loadIdpGuideDataCached } from "@/lib/guides/idp-seasons";
import { draftRoundSentences, loadIdpAdpCached, type IdpAdpSummary } from "@/lib/guides/idp-adp";
import { IDP_PRESETS, IDP_PRESET_LABEL, type IdpPresetKey } from "@/lib/guides/idp-scoring-presets";
import { rankGroups } from "@/lib/guides/idp-scarcity";
import { EligibilityFigure, RankGroupFigure, StarterCountFigure, StabilityFigureView } from "./idp-figures";
import {
  ChaseOrIgnoreQuiz,
  InSeasonChecklist,
  ReplacementLevel,
  ScoringSwitcher,
  StackingCheck,
} from "./idp-classroom";

/**
 * /guides/idp-fantasy-football (plan section 7.3, IDP-220).
 *
 * Ten lessons on individual defensive player (IDP) leagues. Every figure is
 * read at request time from our own tables through lib/guides/idp-seasons.ts
 * (force-dynamic, cached an hour in the data cache): the starter counts and
 * the tackle-stacking count from the leagues we hold, the stability figures
 * and the scoring switcher's stat lines from player_idp_seasons. Every point
 * figure names its scoring. Outside figures (the survey, the scoring systems,
 * the sack stability finding) are attributed in the sentence that uses them
 * and listed under Sources.
 *
 * No wins-above-replacement vocabulary anywhere (CLAUDE.md naming rule);
 * ASCII only; one h1.
 *
 * Source and format: the guide shows no value-source figures and no
 * format-dependent values (the generic-guide exception in CLAUDE.md).
 */

const SLUG = "idp-fantasy-football";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-24T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "IDP Fantasy Football: Scoring, Positions and Strategy";
const DESCRIPTION =
  "What IDP fantasy football is, how IDP scoring and league settings change which defenders matter, and how to draft and manage linebackers, defensive linemen and defensive backs.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "idp fantasy football",
    "what is idp fantasy football",
    "idp scoring",
    "idp scoring settings",
    "idp league settings",
    "idp positions",
    "dynasty idp strategy",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  openGraph: {
    type: "article",
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    siteName: SITE.name,
    locale: "en_US",
    publishedTime: PUBLISHED_AT,
    modifiedTime: UPDATED_AT,
    authors: [SITE.author.name],
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

export const dynamic = "force-dynamic";

const LESSONS = IDP_GUIDE_LESSONS;

const TOC_ITEMS = [
  ...LESSONS.map((l) => ({ id: l.id, label: l.title })),
  { id: "faq-heading", label: "Questions, answered" },
];

const LINK = "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";

function Para({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 leading-relaxed text-ink-muted">{children}</p>;
}

function lessonEyebrow(id: string): string {
  const i = LESSONS.findIndex((l) => l.id === id);
  return `Lesson ${i + 1} of ${LESSONS.length}`;
}

function Lesson({
  id,
  heading,
  tone = "cyan",
  children,
}: {
  id: string;
  heading: string;
  tone?: "cyan" | "purple";
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <GuideSectionHeader id={id} eyebrow={lessonEyebrow(id)} heading={heading} tone={tone} />
      {children}
    </section>
  );
}

const SCORING_ROWS: { key: string; label: string }[] = [
  { key: "idp_tkl_solo", label: "Solo tackle" },
  { key: "idp_tkl_ast", label: "Assisted tackle" },
  { key: "idp_tkl_loss", label: "Tackle for loss" },
  { key: "idp_sack", label: "Sack" },
  { key: "idp_qb_hit", label: "Quarterback hit" },
  { key: "idp_pass_def", label: "Pass defended" },
  { key: "idp_int", label: "Interception" },
  { key: "idp_ff", label: "Forced fumble" },
  { key: "idp_fum_rec", label: "Fumble recovery" },
  { key: "idp_def_td", label: "Defensive touchdown" },
  { key: "idp_safe", label: "Safety" },
  { key: "idp_blk_kick", label: "Blocked kick" },
];
const PRESET_ORDER: IdpPresetKey[] = ["idp123", "big3", "fantasypros", "espn"];

function ScoringTable() {
  return (
    <div className="mt-6 overflow-x-auto" role="region" aria-label="Four IDP scoring systems compared" tabIndex={0}>
      <DataTable
        caption="Points per defensive stat in four IDP scoring systems. A dash means the system does not score it."
        head={
          <>
            <Th>Stat</Th>
            {PRESET_ORDER.map((k) => (
              <Th key={k} numeric>
                {IDP_PRESET_LABEL[k]}
              </Th>
            ))}
          </>
        }
      >
        {SCORING_ROWS.map((row) => (
          <tr key={row.key}>
            <Td>{row.label}</Td>
            {PRESET_ORDER.map((k) => {
              const v = IDP_PRESETS[k][row.key] ?? 0;
              return (
                <Td key={k} numeric>
                  {v === 0 ? "-" : v}
                </Td>
              );
            })}
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

/**
 * Lesson 4's opening sentence, built only from the positions we can measure.
 * A position without a twelfth qualifying player is left out of the sentence
 * rather than printed as "not enough data" in the middle of it (review 48).
 */
function firstVersusTwelfth(byRank: Record<"DL" | "LB" | "DB", number[]>, season: number): string | null {
  const noun = { LB: "linebacker", DL: "defensive lineman", DB: "defensive back" } as const;
  const parts = (["LB", "DL", "DB"] as const)
    .filter((pos) => byRank[pos].length >= 12)
    .map((pos) => `the best ${noun[pos]} averaged ${byRank[pos][0].toFixed(1)} points a game and the twelfth ${byRank[pos][11].toFixed(1)}`);
  if (parts.length === 0) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join("; ")}; and ${parts[parts.length - 1]}`;
  return `In ${season}, in Sleeper default IDP scoring, ${list}.`;
}

export default async function IdpFantasyFootballGuide() {
  const lastComplete = Number(currentNflSeason()) - 1;
  const [isMember, data, adp] = await Promise.all([
    isDiscordMember(),
    loadIdpGuideDataCached(lastComplete),
    // A failed ADP read leaves lesson 7's market figures out; it never takes
    // the page down, and the throw inside means the failure is not cached.
    loadIdpAdpCached().catch((err: unknown): IdpAdpSummary | null => {
      console.error("[idp guide] ADP read failed", err);
      return null;
    }),
  ]);
  const rounds = adp ? draftRoundSentences(adp, formatEasternDate(adp.asOf)) : null;
  const marketFirstRound = adp?.oneQb?.firstRound ?? adp?.superflex?.firstRound ?? null;
  const f = data.leagues;
  const FAQ = buildIdpFaq(f);
  const exampleLb = data.topByPosition.LB[0] ?? null;
  const byRank = data.perGameRank;
  const scarcityLead = firstVersusTwelfth(byRank, data.season);
  const e = data.eligibility;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: TITLE,
      description: DESCRIPTION,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      datePublished: PUBLISHED_AT,
      dateModified: UPDATED_AT,
      author: authorJsonLd(),
      publisher: {
        "@type": "Organization",
        name: SITE.name,
        url: SITE.url,
        logo: { "@type": "ImageObject", url: `${SITE.url}/img/ff-beacon-logo.png` },
      },
      image: [{ "@type": "ImageObject", url: OG_IMAGE, width: 1200, height: 630 }],
      mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
      url: CANONICAL,
      articleSection: "Guides",
      about: { "@type": "Thing", name: "Individual defensive player (IDP) fantasy football leagues" },
    },
    faqPageJsonLd(FAQ),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE.url}/guides` },
        { "@type": "ListItem", position: 3, name: TITLE, item: CANONICAL },
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
          eyebrow="Guides"
          title="IDP fantasy football"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "Individual defensive players", tone: "purple" },
            { label: `${LESSONS.length} lessons`, tone: "cyan" },
          ]}
        >
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-subtle">
            <time dateTime={PUBLISHED_AT}>{formatEasternDate(PUBLISHED_AT)}</time>
            <span>
              By{" "}
              <Link
                rel="author"
                href={SITE.author.bylineHref}
                className="font-semibold text-ink-muted underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {SITE.author.name}
              </Link>
            </span>
          </p>
        </PageMasthead>
      </PageBody>

      <GuideShell toc={<GuideToc items={TOC_ITEMS} />}>
        <article className="text-[15px] sm:text-base">
          <section aria-labelledby="short-heading">
            <h2 id="short-heading" className="text-xl font-semibold text-ink">
              The short version
            </h2>
            <ul role="list" className="mt-4 list-disc space-y-2 pl-6 leading-relaxed text-ink-muted">
              <li>Read your league&apos;s defensive scoring before anything else. It decides which position matters.</li>
              <li>Linebackers who stay on the field for every down lead tackle-heavy leagues. Edge rushers close the gap when sacks pay more.</li>
              <li>Per-game points and tackles repeat from one season to the next better than sacks do for linebackers and defensive backs.</li>
              <li>Draft offense first in most leagues, and take defenders once the starters you need are the only ones left.</li>
            </ul>
          </section>

          <Lesson id="what-heading" heading="What IDP is, and how many defenders a league starts" tone="purple">
            <Para>
              IDP stands for individual defensive players. A normal league starts one team defense
              that scores for the whole unit. An IDP league starts real defenders as well, or
              instead: defensive linemen, linebackers and defensive backs, each scoring for his own
              tackles, sacks, passes defended and turnovers.
            </Para>
            <Para>
              How many defenders a league starts varies more than any other setting. The IDP Show&apos;s
              2025 survey of 95,284 leagues found 13.3% ran IDP and another 37.1% ran a lighter
              version, with 7.04 IDP starters on average.
              {f.medianStarters !== null ? (
                <>
                  {" "}
                  Of the {f.allLeagues} leagues synced on FF Beacon, {f.leagues} start defenders,
                  and the median one of those starts {f.medianStarters}.
                </>
              ) : null}
            </Para>
            <div className="mt-6">
              <StarterCountFigure facts={f} />
            </div>
          </Lesson>

          <Lesson id="scoring-heading" heading="Read your scoring first">
            <Para>
              Two IDP leagues with the same roster slots can reward completely different players.
              The table sets four common systems side by side. Sleeper&apos;s default pays 2 for a
              solo tackle and 6 for a sack; Big 3 scoring pays less for tackles and more for a
              quarterback hit and a pass defended; ESPN and FantasyPros pay 1.5 for a solo tackle,
              between the two, and less than either for a sack or a pass defended.
            </Para>
            <ScoringTable />
            <GuideSubheading className="mt-8">The stacking trap</GuideSubheading>
            <Para>
              On Sleeper a rule called Tackle adds on top of the solo and assisted tackle rules
              instead of replacing them. A sack also earns whatever a tackle, a tackle for loss and a
              quarterback hit are worth, because all four are recorded on the same play. Of our{" "}
              {f.leagues} IDP leagues, {f.plainTackle} score the Tackle rule, and {f.plainTackleAndSolo}{" "}
              of those also score solo tackles, so a solo tackle counts twice there.
            </Para>
            <StackingCheck />
          </Lesson>

          <Lesson id="switch-heading" heading="The same players under four scoring systems" tone="purple">
            <Para>
              Scoring changes the order of players as well as their totals. Below are real{" "}
              {data.season} season stat lines. Watch where the linebackers and the edge rushers land
              as the price of a tackle, a sack and a quarterback hit changes.
            </Para>
            <ScoringSwitcher season={data.season} players={data.topByPosition} />
          </Lesson>

          <Lesson id="scarcity-heading" heading="Which position runs out first">
            <Para>
              The question for a draft is how far the twelfth-best player at a position falls
              behind the best one.{scarcityLead ? ` ${scarcityLead}` : null}
            </Para>
            <div className="mt-6">
              <RankGroupFigure rows={rankGroups(byRank)} season={data.season} />
            </div>
            <Para>
              A position where the twelfth player is close to the first is one you can wait on. A
              position with a steep drop is where an early pick buys something the waiver wire
              cannot replace. How steep it is for you depends on how many your league starts, so
              try your own number.
            </Para>
            <ReplacementLevel season={data.season} byRank={byRank} />
          </Lesson>

          <Lesson id="repeat-heading" heading="What repeats from one season to the next" tone="purple">
            <Para>
              A defender&apos;s role repeats better than his big plays. The figure measures, for every
              player with at least eight games in two straight seasons, how closely year one
              predicted year two. Sports Info Solutions found the same about sacks: a pass
              rusher&apos;s pressures predict next season&apos;s sacks better than his sacks do (an
              R-squared of 0.27 against 0.13).
            </Para>
            <div className="mt-6">
              <StabilityFigureView figures={data.stability} span={data.stabilitySpan} />
            </div>
            <Para>
              Two cautions. Tackles are not an official NFL statistic: the home team&apos;s stat crew
              charts them, and crews differ in how often they credit an assist. And the positions
              above are today&apos;s labels applied to past seasons, so a player who moved from safety
              to linebacker counts as a linebacker in both years.
            </Para>
            <ChaseOrIgnoreQuiz figures={data.stability} />
          </Lesson>

          <Lesson id="labels-heading" heading="Position labels change value">
            <Para>
              Sleeper lets some defenders play two positions.
              {e.onTeam > 0 ? (
                <>
                  {" "}
                  Of the {e.onTeam} defenders on an NFL roster today, {e.dlLb} are eligible at
                  both defensive line and linebacker, and {e.dbLb} at both linebacker and
                  defensive back.
                </>
              ) : null}{" "}
              An edge rusher listed at both is worth more in a league that starts two linemen and
              three linebackers, because he fits whichever slot is thin that week.
            </Para>
            {e.onTeam > 0 ? (
              <div className="mt-6">
                <EligibilityFigure counts={e} />
              </div>
            ) : null}
            <Para>
              The label can change during a season. Check it in your league before you trade for a
              player because of where he is eligible.
            </Para>
          </Lesson>

          <Lesson id="draft-heading" heading="Drafting defenders" tone="purple">
            <Para>
              Most IDP leagues start more offensive players than defenders. Lesson 4 shows how far
              the twelfth defender at each position trails the first; set that against the same gap
              at your offensive positions before you spend an early pick on a defender.
            </Para>
            <GuideSubheading className="mt-8">Where defenders go in real drafts</GuideSubheading>
            {rounds ? (
              <>
                <Para>
                  Sleeper publishes an average draft position for IDP drafts: one figure for
                  one-quarterback leagues and one for superflex. FF Beacon reads it every
                  morning. {rounds.market}
                </Para>
                {rounds.positions ? <Para>{rounds.positions}</Para> : null}
              </>
            ) : null}
            <Para>
              {rounds ? "Published advice for comparison. " : null}IDP+ tells a 12-team league to
              start on defenders around round 7 and to take its first defensive backs in rounds 12
              to 15. Mike Woellert at Fantasy Life targets his first IDP in the seventh round. Gary
              Davenport at Footballguys
              {marketFirstRound !== null && marketFirstRound > 6 ? ", earlier than the market," : ""} puts
              the elite defenders between rounds 4 and 6, in a league that starts two at each
              position. Draft position moves through the summer and changes with league size and
              scoring, so use these rounds as the shape of the market rather than a pick-by-pick
              plan.
            </Para>
            <Para>
              When you do draft defenders, draft roles: a linebacker who stays on the field on third
              down, a safety who plays near the line of scrimmage, an edge rusher who plays every
              down rather than only on passing downs. Box safeties usually outscore free safeties and
              cornerbacks.
            </Para>
          </Lesson>

          <Lesson id="season-heading" heading="Managing IDP in season">
            <Para>
              Defenders are streamable in a way quarterbacks are not. A linebacker promoted after an
              injury ahead of him can start the same week. Every defender&apos;s player page shows
              his snap share, his depth chart spot and his projected line, scored under the system
              you pick.
              {exampleLb?.slug ? (
                <>
                  {" "}
                  <Link href={`/players/${exampleLb.slug}`} className={LINK}>
                    {exampleLb.name}&apos;s page
                  </Link>{" "}
                  is one to start with.
                </>
              ) : null}
            </Para>
            <InSeasonChecklist />
          </Lesson>

          <Lesson id="dynasty-heading" heading="Dynasty IDP" tone="purple">
            <Para>
              IDP is mostly a dynasty format. In The IDP Show&apos;s 2025 survey, 71.1% of IDP
              managers played it in dynasty leagues. Lesson 5 is the dynasty lesson in short: role
              and snap share carry over from one season to the next better than a big sack total
              does.
            </Para>
            <Para>
              No value source prices defensive players, so FF Beacon&apos;s trade tools grade a trade
              on its offensive pieces and say how many defenders they left out. Judge the defenders
              in a deal on role and snap share.
            </Para>
          </Lesson>

          <Lesson id="setup-heading" heading="Setting up an IDP league">
            <Para>
              Three starting points, from lightest to heaviest. Add one IDP flex slot to an
              existing league if your managers are new to defense. Start one lineman, one linebacker,
              one defensive back and one IDP flex for a balanced league. Start two of each plus two
              IDP flex slots for a league where defense decides games.
            </Para>
            <Para>
              Then set the scoring on purpose. Sleeper&apos;s default is a sensible start; if you add
              the Tackle rule, remember it stacks on solo tackles. Our{" "}
              <Link href="/guides/fantasy-football-terms#idp" className={LINK}>
                glossary
              </Link>{" "}
              covers every abbreviation you will meet in the settings.
            </Para>
          </Lesson>

          <section aria-labelledby="faq-heading" className="mt-12">
            <GuideSectionHeader id="faq-heading" heading="Questions, answered" />
            <div className="mt-4">
              <FaqAccordion items={FAQ} />
            </div>
          </section>

          <section aria-labelledby="sources-heading" className="mt-12">
            <h2 id="sources-heading" className="text-lg font-semibold text-ink">
              Sources
            </h2>
            <ul role="list" className="mt-3 list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-ink-muted">
              <li>
                Sleeper default IDP scoring: read from a fresh Sleeper league on 2026-09-23.{" "}
                <a className={LINK} href="https://support.sleeper.com/en/articles/3998131-what-scoring-options-are-available">
                  Sleeper scoring options
                </a>
                ,{" "}
                <a className={LINK} href="https://support.sleeper.com/en/articles/3186339-what-stacks">
                  what stacks
                </a>
                ,{" "}
                <a className={LINK} href="https://support.sleeper.com/en/articles/2441282-stat-corrections">
                  stat corrections
                </a>
                .
              </li>
              <li>
                <a className={LINK} href="https://www.theidpshow.com/p/big-3-scoring">Big 3 scoring</a>,{" "}
                <a className={LINK} href="https://www.fantasypros.com/scoring-settings/">FantasyPros scoring settings</a>,{" "}
                <a className={LINK} href="https://www.espn.com/fantasy/football/story/_/id/45525668/2025-fantasy-football-idp-league-scoring-travis-hunter-eligibility">
                  ESPN IDP scoring
                </a>
                .
              </li>
              <li>
                <a className={LINK} href="https://www.theidpshow.com/p/2025-state-of-idp-report-part-1-fantasy-football">
                  The IDP Show, 2025 State of IDP report
                </a>
                .
              </li>
              <li>
                <a className={LINK} href="https://www.sportsinfosolutions.com/2024/05/28/under-pressure-projecting-sack-numbers-using-advanced-pass-rushing-metrics/">
                  Sports Info Solutions on projecting sacks
                </a>
                .
              </li>
              <li>
                <a className={LINK} href="https://www.si.com/nfl/2015/09/18/nfl-tackling-history-stat-leaders-lavonte-david">
                  Sports Illustrated on how tackles are recorded
                </a>
                .
              </li>
              <li>
                Sleeper IDP average draft position, one-quarterback and superflex, read from
                Sleeper&apos;s projections data every morning
                {adp ? `; the figures above are from ${formatEasternDate(adp.asOf)}` : ""}.
              </li>
              <li>
                <a className={LINK} href="https://idpplus.com/2026-idp-draft-strategy-guide-when-to-draft-lbs-dl-and-dbs-with-position-tiers/">
                  IDP+, 2026 IDP draft strategy guide
                </a>
                ,{" "}
                <a className={LINK} href="https://www.fantasylife.com/articles/fantasy/idp-fantasy-football-2026-strategy-guide-lineup-construction-dra">
                  Fantasy Life, 2026 IDP strategy guide
                </a>
                ,{" "}
                <a className={LINK} href="https://www.footballguys.com/article/2026-idp-draft-blueprint-godfathers-step-by-step-guide">
                  Footballguys, 2026 IDP draft blueprint
                </a>
                .
              </li>
              <li>
                League counts, stat lines and year-to-year figures: FF Beacon&apos;s synced leagues and
                weekly stats, read when this page loads.
              </li>
            </ul>
          </section>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="Defense wins leagues too"
        heading="Not sure which linebacker to start?"
        body="Post your lineup and your league's defensive scoring in our Discord and real players will help you set it, free. I am in there too."
        isMember={isMember}
        memberHeading="You know the positions. Now check your league."
        memberBody="League Pulse reads your Sleeper league's own scoring and roster slots."
        memberCtaHref="/tools/league-pulse"
        memberCtaLabel="Open League Pulse"
      />
    </main>
  );
}

