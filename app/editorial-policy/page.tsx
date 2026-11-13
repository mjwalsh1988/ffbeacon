import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { pageShareMetadata } from "@/lib/page-og";
import { SITE } from "@/lib/site";

const DESCRIPTION =
  "Who writes FF Beacon, where its numbers come from, how the Beacon Brief and its Relays are produced, where language models are used, and how a mistake gets corrected.";

export const metadata: Metadata = {
  alternates: { canonical: "/editorial-policy" },
  title: "Editorial Policy",
  description: DESCRIPTION,
  ...pageShareMetadata({
    key: "editorial-policy",
    title: "Editorial Policy",
    description: DESCRIPTION,
    path: "/editorial-policy",
  }),
};

const EFFECTIVE_DATE = "November 13, 2026";
const EFFECTIVE_DATE_ISO = "2026-11-13";
const CONTACT = SITE.legalContactEmail;

/**
 * /editorial-policy
 *
 * Written to the same rule as the privacy policy: it describes what the code
 * and the owner actually do, and nothing else. Each claim below has a place in
 * the repository that makes it true, and a change there is a change here:
 *
 *   - Guides carry a byline and two dates: lib/guides/published.ts.
 *   - The research for a Brief edition is gathered by an automated run from
 *     the week's Relays and the site's own numbers (lib/brief-desk/bundle.ts
 *     and instructions-seed.ts). The owner puts the edition together, rewrites
 *     and edits it, and his approval is the only path to published
 *     (lib/brief-desk/publish.ts).
 *   - Relays are automated summaries of reporters' posts and credit the
 *     reporter (lib/beacon-brief/ai.ts, app/brief/relay/[slug]/page.tsx).
 *     They are noindex (lib/beacon-brief/index-quality.ts).
 *
 * Wording rule from the owner (2026-11-13): the page says a language model is
 * used for RESEARCH and never that one writes anything. The owner reviews,
 * rewrites and edits every edition himself, and the page says that.
 *   - Trade verdicts and their reasons are arithmetic and fixed templates,
 *     never generated text (lib/trade-impact/).
 *   - No value source prices a defender (lib/site.ts isDefender and the IDP
 *     section of CLAUDE.md).
 *
 * It makes no promise about how fast a correction is made, because one person
 * makes them.
 */

const LINK_CLASS =
  "text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href as Route} className={LINK_CLASS}>
      {children}
    </Link>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-2xl font-semibold tracking-tight text-ink">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function EditorialPolicyPage() {
  return (
    <main id="main">
      <PageBody width="reading">
        <PageMasthead
          eyebrow="How we work"
          title="Editorial Policy"
          description={
            <>
              Effective <time dateTime={EFFECTIVE_DATE_ISO}>{EFFECTIVE_DATE}</time>
            </>
          }
        />
        <article className="mt-8 space-y-8 leading-relaxed text-ink-muted">
          <p>
            This page says who writes {SITE.name}, where the numbers on it come from,
            which parts are written by a person and which are produced by software,
            and what happens when something is wrong. The short version: one person
            is responsible for everything published here, and nobody pays to change
            what a page says.
          </p>

          <Section id="who" title="1. Who is responsible">
            <p>
              {SITE.name} is built, written and published by {SITE.author.name}, a
              fantasy manager of twenty seasons who is blind and plays by the
              numbers. His background is on the{" "}
              <PageLink href={SITE.author.bylineHref}>author page</PageLink>, and the
              reasons the site exists are on the{" "}
              <PageLink href="/about">About page</PageLink>. There is no staff, no
              parent company and no outside editor. When a page is wrong, it is his
              mistake to fix.
            </p>
          </Section>

          <Section id="independence" title="2. Independence and money">
            <p>
              The site is self funded. Today the money it takes in comes from two
              places: donations, and the Personal Team Review, a written review of one
              team that a reader can buy. Neither buys a better ranking, a kinder
              trade grade or a mention anywhere on the site, and the rest of the site
              is free to use.
            </p>
            <p>
              Advertising would be a third source if it runs. An ad on a page is
              served by Google, which chooses it. An advertiser has no say in what is
              written and never sees a page before it is published. The{" "}
              <PageLink href="/privacy">Privacy Policy</PageLink> says what serving
              an ad involves. There is no sponsored content today, and if a sponsor
              ever backs a tool or an edition, the page will say so in words beside
              the thing sponsored.
            </p>
            <p>
              {SITE.name} is a fantasy football site. It is not a sportsbook, it takes
              no bets, and nothing on it is betting advice. Where a weekly edition
              shows a point spread or a total for a game, that is context for how the
              game was expected to go, not a recommendation to wager on it.
            </p>
          </Section>

          <Section id="guides" title="3. The guides">
            <p>
              Every <PageLink href="/guides">guide</PageLink> carries{" "}
              {SITE.author.name}&apos;s byline, the date it was published and the date
              it was last updated. A guide explains a method the site really uses, so
              when the method changes the guide is rewritten and its updated date
              moves. A date is never changed to make an old page look new.
            </p>
            <p>
              A guide defines a term where it first uses it, and shows the arithmetic
              behind a claim instead of asking you to take it on trust. If you cannot
              follow one, that is a fault in the guide, and worth{" "}
              <PageLink href="/contact">telling us about</PageLink>.
            </p>
          </Section>

          <Section id="brief" title="4. The Beacon Brief and its Relays">
            <p>
              The <PageLink href="/brief">Beacon Brief</PageLink> has two main kinds
              of page, and they are made differently.
            </p>
            <h3 className="pt-1 text-base font-semibold text-ink">Relays</h3>
            <p>
              A Relay is a short report of something an NFL reporter posted: an
              injury, a signing, a depth chart change. A Relay is an automated
              summary of the reporter&apos;s post, and each one names the reporter
              it came from. It is published once a software check confirms that
              the names and numbers in it are in the post. One that fails the
              check is held back for {SITE.author.name} to look at.
            </p>
            <p>
              A Relay is not original reporting and does not claim to be. Relays are
              kept out of search engines on purpose, because a summary of someone
              else&apos;s report is not a page that should compete with it. Older
              single-story articles in the Brief were produced the same automated way
              and are kept out of search engines too.
            </p>
            <h3 className="pt-1 text-base font-semibold text-ink">Weekly editions</h3>
            <p>
              A weekly edition is the long read: the week&apos;s games, how the
              projections did, injuries, and what to do about it. The research for an
              edition is done with the help of a language model, which gathers
              material from three places only: the week&apos;s Relays, numbers the
              site computed from its own data, and pages it fetches to check that a
              report is still true. Its instructions forbid it from bringing back a
              roster, a timeline or a contract detail that is in none of those.
            </p>
            <p>
              {SITE.author.name} puts each edition together from that research. He
              reviews all of it, rewrites it, edits it, and decides what the edition
              says. No edition is published automatically: one goes live only when
              he approves it. The charts,
              tables and score cards in an edition are drawn by the site from its own
              data, so a figure in a card is the stored figure and not a number
              somebody typed.
            </p>
          </Section>

          <Section id="numbers" title="5. Where the numbers come from">
            <p>
              Player values come from the value source you choose, and the page names
              the source by name wherever a value appears. A source is only offered
              for the scoring formats it really publishes. Where a source defines a
              format as a formula over its own base values, we apply that formula
              instead of inventing a number.
            </p>
            <p>
              League data and most stats come from Sleeper. Weekly projections come
              from Sleeper or from {SITE.name}&apos;s own model, and the page names
              which one it is showing. Projections are rescored under each
              format&apos;s own rules, and inside a synced league under that
              league&apos;s own scoring settings. Historical rosters in the games
              come from the nflverse data releases, and the game lines in a weekly
              edition come from a betting odds data feed. The league models and how
              each is calculated are set out in{" "}
              <PageLink href="/guides/how-ff-beacon-works">
                How {SITE.name} Works
              </PageLink>
              .
            </p>
            <p>
              When a number does not exist, the page says so in words. No value
              source prices individual defensive players, so a defender shows
              &quot;No market value&quot; and never a zero. A week that has not been
              played shows a projection labeled as a projection, and a model that has
              not been calculated for a league says that it has not, in place of a
              figure that would be believed.
            </p>
          </Section>

          <Section id="models" title="6. Where language models are used, and where they are not">
            <p>
              Language models are used for research: summarizing a reporter&apos;s
              post for a Relay, and gathering the material for each weekly edition,
              as described above. The guides and the editions are written by{" "}
              {SITE.author.name}. Language models do not grade trades. A trade verdict
              and every reason printed under it come from arithmetic and fixed
              sentence templates, so each sentence cites a figure that is on the same
              screen and can be checked against it. Projections and the league models
              are calculations, not generated text.
            </p>
            <p>
              One more place a model can appear: {SITE.name}&apos;s own player values
              are built from a formula, and that formula can include a small, capped
              adjustment suggested by a language model. Values from the other sources
              are shown as those sources publish them.
            </p>
          </Section>

          <Section id="corrections" title="7. Corrections">
            <p>
              If something here is wrong, say so through the{" "}
              <PageLink href="/contact">contact page</PageLink> or by email to{" "}
              <a href={`mailto:${CONTACT}`} className={LINK_CLASS}>
                {CONTACT}
              </a>
              . Name the page and what is wrong with it. A factual error in a guide or
              an edition is fixed on the page and the updated date changes with it. A
              wrong number that comes from a calculation is fixed in the calculation,
              so every page that uses it is corrected together.
            </p>
            <p>
              We do not quietly delete a page to make a mistake disappear, and we do
              not change what a past edition said about a game after the fact, beyond
              correcting an error. An older edition may be rebuilt into a newer page
              layout; when that happens it keeps its address and its original date.
            </p>
          </Section>

          <Section id="readers" title="8. What readers post">
            <p>
              Signal profiles, ranking boards and wall posts are written by the
              readers who own them and are their views, not the site&apos;s. Wall
              posts and comments carry a Report control for signed-in readers, and
              reports are reviewed by a person. To report a profile or a ranking
              board, <PageLink href="/contact">write to us</PageLink>. The{" "}
              <PageLink href="/terms">Terms of Service</PageLink> set out what may be
              posted.
            </p>
          </Section>

          <Section id="changes" title="9. Changes to this policy">
            <p>
              When how the site is written changes, this page changes with it and the
              date at the top moves. Questions about any of it go to{" "}
              <a href={`mailto:${CONTACT}`} className={LINK_CLASS}>
                {CONTACT}
              </a>
              .
            </p>
          </Section>
        </article>
      </PageBody>
    </main>
  );
}
