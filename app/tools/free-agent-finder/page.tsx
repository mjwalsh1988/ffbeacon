import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleCheck, CircleSlash, Search, Users } from "lucide-react";
import { SITE } from "@/lib/site";
import { pageShareMetadata } from "@/lib/page-og";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import { createClient } from "@/lib/supabase/server";
import { loadSavedSleeperHandle } from "@/lib/sleeper-handle/resolve";

/**
 * /tools/free-agent-finder
 *
 * One name, every league you are in, and the ones where he is still free.
 *
 * WHY THIS PAGE EXISTS. The feature was already built (`lib/free-agent-finder.ts`
 * plus `components/free-agent-finder-panel.tsx`) and had no URL of its own: it
 * opened from a button inside `/my-beacon/sleeper-leagues`, so nobody could
 * link to it, nobody could search for it, and the term "free agent finder"
 * (50 a month, no competition in the keyword file) pointed at nothing.
 *
 * WHY THE SEARCH ITSELF STAYS BEHIND THE SIGN-IN. `searchFreeAgent` is
 * deliberately auth-gated, and its own header says the gate is about keeping
 * this a member surface rather than about protecting rows. Quietly removing an
 * auth boundary somebody chose on purpose is not a decision a landing page
 * should make, so this page routes a signed-in reader straight into the
 * working panel and gives a signed-out one both the sign-in path and the
 * genuinely account-free alternative. If the owner wants it opened up, the one
 * change is in the action, not here.
 *
 * WHAT MAKES IT MORE THAN A DOOR. The question this tool answers is one nobody
 * can answer from inside a single league, and most readers have never realised
 * it is answerable at all. So the page explains the question, shows the shape
 * of the answer with clearly-labelled sample rows, and is honest that a league
 * we hold no rosters for is reported as unanswered rather than folded in with
 * the real yeses.
 *
 * Source and format: no player values, rankings or projections render here, so
 * there is nothing to resolve.
 */

export const dynamic = "force-dynamic";

const META_TITLE = "Free Agent Finder: Is He Available in Any of My Leagues?";
const META_DESCRIPTION =
  "Check one player against every Sleeper league you are in at once and see which ones still have him unowned. Free, and it never has to be asked league by league.";

export const metadata: Metadata = {
  title: { absolute: META_TITLE },
  description: META_DESCRIPTION,
  alternates: { canonical: "/tools/free-agent-finder" },
  keywords: [
    "free agent finder",
    "fantasy football free agent finder",
    "is he available in my league",
    "sleeper free agents",
    "check player availability all leagues",
    "multi league free agent search",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  ...pageShareMetadata({
    key: "free-agent-finder",
    title: META_TITLE,
    description: META_DESCRIPTION,
    path: "/tools/free-agent-finder",
  }),
};

const FAQ: FaqAccordionItem[] = [
  {
    question: "What does the free agent finder do?",
    answer:
      "It answers one question that nobody can answer from inside a single league: given one player's name, which of your leagues still have him unowned. A manager in fourteen rooms who hears a name on Sunday morning would otherwise have to open fourteen waiver pages to find the two where he is sitting there free. This asks it once.",
  },
  {
    question: "How does it decide whether a player is available?",
    answer:
      "A league is a closed world. Every player is either on one of its rosters or he is not, and not on a roster is free agency. So the check is whether that player appears anywhere in the league's stored rosters, and the answer is the complement. Injured reserve and taxi squad players count as rostered, because they are, and the result says which slot a rostered player is sitting in.",
  },
  {
    question: "Does it trigger a sync of my leagues?",
    answer:
      "No, and that is deliberate. It reads rosters already stored and nothing else. A league nobody has opened on FF Beacon yet is reported as unanswered rather than as a yes, because with no rosters to be absent from, every player in the world would read as free. Those leagues are counted and named separately so you can see the question was asked of them.",
  },
  {
    question: "Do I need an account?",
    answer:
      "For the multi-league search, yes, because it runs against the leagues saved to your account. There is an account-free version of the neighbouring question though: open any Sleeper league in League Pulse and the lineups page lists that league's free agents, ranked against the roster you are looking at.",
  },
  {
    question: "How is this different from my platform's own free agent list?",
    answer:
      "Your platform can only ever answer for the league you are currently looking at. The point of this is the comparison across all of them at once, which is the version of the question a multi-league manager actually has.",
  },
  {
    question: "How many leagues can it check?",
    answer:
      "Every league tied to your saved Sleeper username, up to a cap that exists so one search cannot turn into an unbounded scan. In practice nobody is in enough leagues to reach it.",
  },
];

/** One clearly-labelled sample row, so the shape of the answer is visible. */
const SAMPLE: { league: string; status: "free" | "taken" | "unknown"; detail: string }[] = [
  { league: "Example league A", status: "free", detail: "Not on any roster" },
  { league: "Example league B", status: "free", detail: "Not on any roster" },
  { league: "Example league C", status: "taken", detail: "On a bench" },
  { league: "Example league D", status: "taken", detail: "On injured reserve" },
  { league: "Example league E", status: "unknown", detail: "Not synced yet" },
];

export default async function FreeAgentFinderPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    saved,
    isMember,
  ] = await Promise.all([
    supabase.auth.getUser(),
    loadSavedSleeperHandle(supabase),
    isDiscordMember(),
  ]);

  const signedIn = !!user;
  const handle = saved?.username ?? null;

  const webApplicationLd = webApplicationJsonLd({
    name: META_TITLE,
    description: META_DESCRIPTION,
    url: "/tools/free-agent-finder",
    category: "SportsApplication",
  });

  const jsonLd = [
    webApplicationLd,
    faqPageJsonLd(FAQ),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Tools", item: `${SITE.url}/tools` },
        {
          "@type": "ListItem",
          position: 3,
          name: "Free Agent Finder",
          item: `${SITE.url}/tools/free-agent-finder`,
        },
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

      <PageBody width="tool">
        <PageMasthead
          eyebrow="Tools"
          title="Free agent finder"
          chips={[
            { label: "Free", tone: "cyan" },
            { label: "Sleeper", tone: "purple" },
            { label: "Every league at once", tone: "plain" },
          ]}
          description="One player, every league you are in, and the ones where he is still sitting there unowned. The question you cannot answer from inside a single league."
          actions={
            signedIn ? (
              <Link
                href="/my-beacon/sleeper-leagues"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-base transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Search aria-hidden="true" className="h-4 w-4" />
                Open the finder
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-base transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Sign in to search your leagues
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/tools/league-pulse"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Users aria-hidden="true" className="h-4 w-4" />
                  No account: browse a league
                </Link>
              </>
            )
          }
        />

        {signedIn && (
          <p
            role="status"
            className="mt-6 rounded-card border border-brand-cyan/40 bg-brand-cyan/5 px-4 py-3 text-sm leading-relaxed text-ink-muted"
          >
            {handle ? (
              <>
                <span className="font-medium text-ink">
                  Running against the leagues saved for {handle}.
                </span>{" "}
                The finder opens from your Sleeper leagues page, where the league list it
                searches already lives.
              </>
            ) : (
              <>
                <span className="font-medium text-ink">One step left.</span> Save your Sleeper
                username on your{" "}
                <Link
                  href="/my-beacon/sleeper-leagues"
                  className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
                >
                  Sleeper leagues page
                </Link>{" "}
                and the finder has a set of leagues to search. It is the same handle every
                other tool on the site then stops asking you for.
              </>
            )}
          </p>
        )}

        {/* The short version, in the house gradient card. */}
        <section
          aria-labelledby="short-version"
          className="mt-8 rounded-card p-px"
          style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
        >
          <div className="rounded-card p-4 sm:p-5" style={{ background: "#16162A" }}>
            <h2
              id="short-version"
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "#22D3EE" }}
            >
              The short version
            </h2>
            <p
              className="mt-2 text-[15px] leading-relaxed sm:text-base"
              style={{ color: "#F4F4F8" }}
            >
              You hear a name on Sunday morning. You are in nine leagues. In two of them he is
              free and in the other seven he is not, and the only way to find out is to open
              nine waiver pages. This asks all nine at once and puts the yeses at the top.
            </p>
          </div>
        </section>

        <section aria-labelledby="shape-heading" className="mt-12">
          <h2
            id="shape-heading"
            className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
          >
            What the answer looks like
          </h2>
          <p className="mt-3 max-w-3xl leading-relaxed text-ink-muted">
            One row per league, the available ones first. The rest stay on screen underneath,
            because there is a real difference between &quot;he is taken there&quot; and
            &quot;we did not look&quot;, and a list that quietly dropped the noes would hide
            it.
          </p>

          <div className="mt-5 rounded-card border border-dashed border-brand-purple/50 bg-surface/40 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-brand-purple/50 bg-brand-purple/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-purple">
                Sample
              </span>
              <h3 className="text-sm font-semibold text-ink">
                Invented leagues, not yours, so you can see the shape before signing in
              </h3>
            </div>

            <table className="mt-4 w-full text-sm">
              <caption className="sr-only">
                A sample free agent finder result. These five leagues are invented for
                illustration and are not anybody&apos;s real leagues.
              </caption>
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  <th scope="col" className="py-2 pr-4">
                    League
                  </th>
                  <th scope="col" className="py-2">
                    Answer
                  </th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE.map((row) => (
                  <tr key={row.league} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="py-2.5 pr-4 text-left font-medium text-ink">
                      {row.league}
                    </th>
                    <td className="py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-sm font-medium ${
                          row.status === "free"
                            ? "text-signal-success"
                            : row.status === "taken"
                              ? "text-ink-muted"
                              : "text-ink-subtle"
                        }`}
                      >
                        {row.status === "free" ? (
                          <CircleCheck aria-hidden="true" className="h-4 w-4" />
                        ) : row.status === "taken" ? (
                          <CircleSlash aria-hidden="true" className="h-4 w-4" />
                        ) : (
                          <Search aria-hidden="true" className="h-4 w-4" />
                        )}
                        {row.status === "free"
                          ? "Available"
                          : row.status === "taken"
                            ? "Rostered"
                            : "Not answered"}
                        <span className="text-ink-subtle">, {row.detail}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="how-heading" className="mt-12">
          <h2
            id="how-heading"
            className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
          >
            How it decides
          </h2>
          <ul role="list" className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              {
                title: "A league is a closed world",
                body: "Every player is either on one of its rosters or he is not, and not on a roster is free agency. There is no separate free agent list to go stale.",
              },
              {
                title: "Injured reserve still counts as rostered",
                body: "Because it is. The result says which slot he is in, so you know whether he is genuinely gone or parked somewhere you might pry him loose from.",
              },
              {
                title: "An unsynced league is not a yes",
                body: "With no rosters stored, everybody would read as free. Those leagues are counted and named as unanswered instead, never folded in.",
              },
            ].map((card) => (
              <li
                key={card.title}
                className="rounded-card border border-line bg-surface/60 p-4"
              >
                <h3 className="text-sm font-semibold text-ink">{card.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{card.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="next-heading" className="mt-12">
          <h2
            id="next-heading"
            className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
          >
            Found him. Now what?
          </h2>
          <ul role="list" className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              {
                href: "/tools/faab",
                title: "Work out the bid",
                body: "The FAAB calculator prices the claim against that league's roster, your budget, and what your rivals can still spend.",
              },
              {
                href: "/waiver-wire",
                title: "See who else is free",
                body: "This week's board: who is still available anywhere, whose role just changed, and what a claim like that costs.",
              },
              {
                href: "/tools/who-should-i-start",
                title: "Decide whether to start him",
                body: "Once he is yours, the start/sit tool says whether he beats the player already in the slot.",
              },
            ].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex h-full min-h-11 flex-col rounded-card border border-line bg-surface/60 p-4 transition-colors hover:border-brand-cyan/50 hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <span className="text-sm font-semibold text-ink">{link.title}</span>
                  <span className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                    {link.body}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="faq-heading" className="mt-12">
          <h2
            id="faq-heading"
            className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
          >
            Questions, answered
          </h2>
          <div className="mt-5">
            <FaqAccordion items={FAQ} />
          </div>
        </section>
      </PageBody>

      <DiscordCtaSection
        eyebrow="Nine leagues, one Sunday"
        heading="Playing in more leagues than you can track?"
        body="Our Discord is full of people in the same position, comparing notes on who is free where and what he is going for, free to join."
        isMember={isMember}
        memberHeading="You found him. Now price him."
        memberBody="You're already in the crew, so we'll skip the invite. The FAAB calculator prices the claim against the roster in that specific league."
        memberCtaHref="/tools/faab"
        memberCtaLabel="Open the FAAB calculator"
      />
    </main>
  );
}
