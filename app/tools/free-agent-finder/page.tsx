import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDownWideNarrow,
  Calculator,
  CircleCheck,
  CircleSlash,
  DatabaseZap,
  Hospital,
  LayoutList,
  LogIn,
  Search,
  ShieldQuestion,
  Shirt,
  UserPlus,
  RotateCw,
  Users,
  Waves,
} from "lucide-react";
import { SITE } from "@/lib/site";
import { pageShareMetadata } from "@/lib/page-og";
import { serializeJsonLd, webApplicationJsonLd } from "@/lib/json-ld";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import type { FaqAccordionItem } from "@/components/faq-accordion";
import { ToolExplainer } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { FreeAgentFinder } from "@/components/free-agent-finder-panel";
import { FreeAgentFinderDemo } from "@/components/free-agent-finder-demo";
import { SleeperIdentityCard } from "@/components/sleeper-handle/identity-card";
import { SaveHandleForm } from "@/components/sleeper-handle/save-handle-form";
import { FreeAgentFinderConnectForm } from "@/components/free-agent-finder-connect-form";
import { isDiscordMember } from "@/lib/discord-membership";
import { createClient } from "@/lib/supabase/server";
import { resolveHandleGate } from "@/lib/sleeper-handle/resolve";
import { currentNflSeason, getSleeperLeaguesOrNull } from "@/lib/sleeper";
import { countSyncedLeagues } from "@/lib/free-agent-finder";

/**
 * /tools/free-agent-finder
 *
 * One name, every league you are in, and the ones where he is still free.
 *
 * THE TOOL RUNS HERE. The first version of this page was a landing page whose
 * button sent a signed-in reader to My Beacon, where the finder opened from a
 * quick link inside a side panel. Nobody arriving from a search could tell what
 * to press. Now the page has three states and each one is the next step:
 *
 *   - signed out: a sign-in card that comes back here, plus a working sample
 *     against invented leagues, so the shape of the answer is visible first;
 *   - signed in with no Sleeper username: the save form, inline (it refreshes
 *     the page on save, which turns this into the next state);
 *   - signed in with a username: the real finder, ready to type into.
 *
 * WHY THE SEARCH ITSELF STAYS BEHIND THE SIGN-IN. `searchFreeAgent` is
 * deliberately auth-gated, and its own header says the gate is about keeping
 * this a member surface rather than about protecting rows. This page does not
 * change that decision.
 *
 * One Sleeper call on the signed-in path (the league list, by cached user id),
 * the same call My Beacon makes, and a synced-league count read from our own
 * rows. Nothing here starts a league sync.
 *
 * Source and format: no player values, rankings or projections render here, so
 * there is nothing to resolve.
 */

export const dynamic = "force-dynamic";

const PATH = "/tools/free-agent-finder";
const META_TITLE = "Free Agent Finder: Is He Available in Any of My Leagues?";
const META_DESCRIPTION =
  "Check one player against every Sleeper league you are in at once and see which ones still have him unowned. Free, and it never has to be asked league by league.";

export const metadata: Metadata = {
  title: { absolute: META_TITLE },
  description: META_DESCRIPTION,
  alternates: { canonical: PATH },
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
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  ...pageShareMetadata({
    key: "free-agent-finder",
    title: META_TITLE,
    description: META_DESCRIPTION,
    path: PATH,
  }),
};

const FAQ: FaqAccordionItem[] = [
  {
    question: "What does the free agent finder do?",
    answer:
      "It answers one question that nobody can answer from inside a single league: given one player's name, which of your leagues still have him unowned. A manager in fourteen rooms who hears a name on Sunday morning would otherwise have to open fourteen waiver pages to find the two where he is sitting there free. This asks it once.",
  },
  {
    question: "How do I use it?",
    answer:
      "Sign in, save your Sleeper username once, then type a player's name into the search box on this page and pick him from the list. Every synced league you are in answers at the same time, with the leagues where he is available at the top. Each row links straight into that league.",
  },
  {
    question: "How does it decide whether a player is available?",
    answer:
      "A league is a closed world. Every player is either on one of its rosters or he is not, and not on a roster is free agency. So the check is whether that player appears anywhere in the league's stored rosters, and the answer is the complement. Injured reserve and taxi squad players count as rostered, because they are, and the result says which slot a rostered player is sitting in.",
  },
  {
    question: "Does it trigger a sync of my leagues?",
    answer:
      "Only for leagues we already hold. Any of those last read from Sleeper more than an hour ago is refreshed before the search, up to 12 per search with the oldest first, so a player claimed this morning shows as taken. A league nobody has opened on FF Beacon yet is not pulled in. It is reported as unanswered rather than as a yes, because with no rosters to be absent from, every player in the world would read as free. Press Sync all in My Beacon and those leagues join the next search.",
  },
  {
    question: "Do I need an account?",
    answer:
      "For the multi-league search, yes, because it runs against the leagues tied to the Sleeper username saved on your account. There is an account-free version of the neighbouring question though: open any Sleeper league in League Pulse and its lineups page lists that league's free agents, ranked against the roster you are looking at.",
  },
  {
    question: "Does it work for ESPN or Yahoo leagues?",
    answer:
      "No. It reads Sleeper leagues only, because Sleeper is the platform that publishes league rosters openly.",
  },
  {
    question: "How is this different from my platform's own free agent list?",
    answer:
      "Your platform can only ever answer for the league you are currently looking at. The point of this is the comparison across all of them at once, which is the version of the question a multi-league manager actually has.",
  },
  {
    question: "How many leagues can it check?",
    answer:
      "Every league tied to your saved Sleeper username, up to a cap of 200 that exists so one search cannot turn into an unbounded scan.",
  },
];

export default async function FreeAgentFinderPage() {
  const supabase = await createClient();
  // The shared four-state gate. It fills in a missing Sleeper id through the
  // METERED backfill, so a handle that never resolves cannot spend a Sleeper
  // call on every render of this page.
  const [gate, isMember] = await Promise.all([
    resolveHandleGate(supabase, undefined),
    isDiscordMember(),
  ]);

  const signedIn = gate.kind !== "guest";
  const handle = gate.kind === "member-saved" ? gate.handle : null;
  const sleeperUserId = handle?.sleeperUserId ?? null;
  // A saved handle with no id is either a renamed account or a Sleeper that did
  // not answer; nothing here can tell those apart, so the copy names both.
  const unconfirmed = Boolean(handle) && !sleeperUserId;

  let leagueIds: string[] = [];
  let syncedCount = 0;
  // Null means the REQUEST failed, which is never evidence of zero leagues.
  let leaguesFailed = false;
  if (sleeperUserId) {
    const leagues = await getSleeperLeaguesOrNull(
      sleeperUserId,
      currentNflSeason(),
    );
    if (leagues === null) {
      leaguesFailed = true;
    } else {
      leagueIds = leagues.map((l) => l.league_id);
      syncedCount = await countSyncedLeagues(supabase, leagueIds);
    }
  }
  const rosterMatchName = handle?.displayName ?? handle?.username ?? null;
  const ready = Boolean(sleeperUserId) && !leaguesFailed;

  const jsonLd = [
    webApplicationJsonLd({
      name: META_TITLE,
      description: META_DESCRIPTION,
      url: PATH,
      category: "SportsApplication",
    }),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        {
          "@type": "ListItem",
          position: 2,
          name: "Tools",
          item: `${SITE.url}/tools`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "Free Agent Finder",
          item: `${SITE.url}${PATH}`,
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
          title="Free Agent Finder"
          chips={[
            { label: "Free", tone: "cyan" },
            { label: "Sleeper", tone: "purple" },
            { label: "Every league at once", tone: "plain" },
          ]}
          description="Type one player's name and see every Sleeper league you are in where he is still unowned. The question you cannot answer from inside a single league."
        />

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            {handle ? (
              <>
                <SleeperIdentityCard
                  toolName="the Free Agent Finder"
                  handle={handle}
                  headingLevel={2}
                  compact
                  status={unconfirmed ? "failed" : "idle"}
                  statusMessage={
                    unconfirmed
                      ? `We could not confirm "${handle.username}" with Sleeper just now. If you have changed your Sleeper username, save the new one here. If not, Sleeper may be slow, so reload the page in a minute.`
                      : null
                  }
                >
                  {/* Change mounts this inline. Plain form, not the
                      focus-handing one: the search box is already on screen. */}
                  <SaveHandleForm
                    defaultUsername={handle.username}
                    submitLabel="Save username"
                  />
                </SleeperIdentityCard>
                {leaguesFailed && <SleeperUnavailable />}
                {ready && (
                  <section
                    aria-labelledby="faf-search-heading"
                    className="relative overflow-hidden rounded-modal border border-brand-purple/30 bg-surface p-4 sm:p-6"
                  >
                    <BeaconHairline />
                    <h2
                      id="faf-search-heading"
                      className="mb-4 text-lg font-semibold tracking-tight text-ink sm:text-xl"
                    >
                      Who are you looking for?
                    </h2>
                    <FreeAgentFinder
                      sleeperLeagueIds={leagueIds}
                      sleeperUserId={sleeperUserId}
                      syncedLeagueCount={syncedCount}
                      sleeperUsername={rosterMatchName}
                    />
                  </section>
                )}
              </>
            ) : signedIn ? (
              <ConnectCard />
            ) : (
              <SignInCard />
            )}
          </div>

          <ReadingGuide />
        </div>

        {!ready && (
          <section
            aria-labelledby="faf-sample-heading"
            className="mt-12 scroll-mt-24"
            id="sample"
          >
            <h2
              id="faf-sample-heading"
              className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
            >
              See how it answers
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              Pick a player below. This sample runs against invented leagues so
              you can see what a real search returns before you connect your
              own.
            </p>
            <div className="mt-6">
              <FreeAgentFinderDemo />
            </div>
          </section>
        )}

        <LeagueByLeague />

        <ToolExplainer
          id="free-agent-finder-explainer"
          icon={Search}
          eyebrow="The tool"
          title="A free agent finder for every Sleeper league you play in"
          intro="Sleeper, like every fantasy platform, shows you the free agents for one league at a time. If you play in several, the honest answer to 'is he available in any of my leagues?' means opening each waiver page and searching the same name again. The Free Agent Finder reads the rosters of every Sleeper league tied to your username and tells you, in one search, where the player is still free and where somebody already has him."
          steps={[
            {
              icon: UserPlus,
              title: "Connect your Sleeper username once",
              body: "Sign in and save the username you use on Sleeper. Every tool on FF Beacon then knows your leagues and stops asking.",
            },
            {
              icon: Search,
              title: "Type the player's name",
              body: "Pick him from the list as you type. Defensive players are in there too, for leagues that start them.",
            },
            {
              icon: ArrowDownWideNarrow,
              title: "Free leagues come first",
              body: "Every synced league answers at once. The ones where he is available sit at the top in green; the rest stay underneath with who has him and in which slot.",
            },
            {
              icon: Calculator,
              title: "Go make the claim",
              body: "Each row opens that league. From there the FAAB calculator can price the bid against that room's budgets.",
            },
          ]}
          notes={[
            {
              icon: Waves,
              title: "A league is a closed world",
              body: "Every player is on one of its rosters or he is not, and not on a roster is free agency. There is no separate free agent list to go stale.",
            },
            {
              icon: Hospital,
              title: "Injured reserve still counts as rostered",
              body: "Because it is. The result says which slot he is in, so you know whether he is gone or parked somewhere you might pry him loose from.",
              tone: "purple",
            },
            {
              icon: ShieldQuestion,
              title: "An unsynced league is never a yes",
              body: "With no rosters stored, everybody would read as free. Those leagues are counted as unanswered instead, so a blank never sends you to a waiver page for nothing.",
            },
          ]}
          faq={FAQ}
          next={[
            {
              href: "/tools/faab",
              icon: Calculator,
              title: "Work out the bid",
              body: "The FAAB calculator prices the claim against that league's roster, your budget, and what your rivals can still spend.",
            },
            {
              href: "/waiver-wire",
              icon: LayoutList,
              title: "See who else is free",
              body: "This week's waiver board: whose role just changed and what a claim like that tends to cost.",
              accent: "purple",
            },
            {
              href: "/tools/who-should-i-start",
              icon: Shirt,
              title: "Decide whether to start him",
              body: "Once he is yours, the start/sit tool says whether he beats the player already in the slot.",
            },
            {
              href: "/tools/league-pulse",
              icon: Users,
              title: "Browse one league, no account",
              body: "Open any Sleeper league in League Pulse and its lineups page lists that league's free agents.",
              accent: "purple",
            },
          ]}
        />
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

/* ---------- pieces ---------- */

function BeaconHairline() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-px"
      style={{
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
      }}
    />
  );
}

/** The three moves between arriving here and a first answer. */
const SETUP_STEPS = [
  "Sign in with Google, Discord or email.",
  "Save your Sleeper username once.",
  "Type a player's name and every league answers.",
];

function SetupSteps({ doneThrough }: { doneThrough: number }) {
  return (
    <ol className="mx-auto mt-5 grid max-w-xl gap-2 text-left sm:grid-cols-3">
      {SETUP_STEPS.map((step, i) => {
        const done = i < doneThrough;
        const current = i === doneThrough;
        return (
          <li
            key={step}
            aria-current={current ? "step" : undefined}
            className={`flex items-start gap-2.5 rounded-card border p-3 text-xs leading-relaxed ${
              current
                ? "border-brand-cyan/50 bg-brand-cyan/5 text-ink"
                : "border-line bg-base/40 text-ink-muted"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${
                done
                  ? "bg-signal-success/20 text-signal-success"
                  : current
                    ? "bg-beacon text-black"
                    : "border border-line-accent text-ink-subtle"
              }`}
            >
              {done ? <CircleCheck className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span>
              {done && <span className="sr-only">Done: </span>}
              {current && <span className="sr-only">Current step: </span>}
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SignInCard() {
  const next = encodeURIComponent(PATH);
  return (
    <section
      aria-labelledby="faf-signin-heading"
      className="relative h-full overflow-hidden rounded-modal border border-brand-purple/30 bg-surface p-6 text-center sm:p-8"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 50% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 60%)",
      }}
    >
      <BeaconHairline />
      <span
        aria-hidden="true"
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-card bg-beacon text-black"
      >
        <Search className="h-5 w-5" />
      </span>
      <h2
        id="faf-signin-heading"
        className="mt-4 text-xl font-semibold tracking-tight text-ink sm:text-2xl"
      >
        Sign in to search your leagues.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        The finder checks the leagues tied to your Sleeper username, so it needs
        an account to know which ones are yours. It is free, and you only set it
        up once.
      </p>
      <SetupSteps doneThrough={0} />
      <div className="mt-6 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
        <Link
          href={`/login?next=${next}`}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
        >
          <LogIn aria-hidden="true" className="h-4 w-4" />
          Sign in or create an account
        </Link>
        <Link
          href="#sample"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-line bg-base px-5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
        >
          Try the sample first
        </Link>
      </div>
    </section>
  );
}

function ConnectCard() {
  return (
    <section
      aria-labelledby="faf-connect-heading"
      className="relative overflow-hidden rounded-modal border border-brand-purple/30 bg-surface p-6 sm:p-8"
    >
      <BeaconHairline />
      <h2
        id="faf-connect-heading"
        className="text-xl font-semibold tracking-tight text-ink sm:text-2xl"
      >
        One step left: connect your Sleeper username.
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
        The finder searches the leagues tied to it. Save it here and the search
        box appears on this page straight away. Every other tool on the site
        stops asking for it too.
      </p>
      <SetupSteps doneThrough={1} />
      <div className="mt-6 rounded-card border border-line bg-base/50 p-4 sm:p-5">
        <FreeAgentFinderConnectForm submitLabel="Save and start searching" />
      </div>
    </section>
  );
}

/**
 * Sleeper did not answer the league list request. That says nothing about how
 * many leagues the reader is in, so this is a retry state, never "0 of 0".
 */
function SleeperUnavailable() {
  return (
    <section
      aria-labelledby="faf-unavailable-heading"
      className="rounded-modal border border-line bg-surface p-5 sm:p-6"
    >
      <h2
        id="faf-unavailable-heading"
        className="text-base font-semibold text-ink"
      >
        Sleeper did not send your league list just now.
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        That usually clears within a minute. Nothing about your leagues has
        changed.
      </p>
      <a
        href={PATH}
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <RotateCw aria-hidden="true" className="h-4 w-4" />
        Try again
      </a>
    </section>
  );
}

/**
 * The legend, in the rail beside the tool. Every state a result row can be in,
 * as words with an icon, so the colours never have to carry the meaning on
 * their own. Unanswered leagues are counted under the list rather than drawn as
 * rows, and the legend says so.
 */
function ReadingGuide() {
  const items = [
    {
      icon: CircleCheck,
      tone: "border-signal-success/50 bg-signal-success/15 text-signal-success",
      title: "Free agent",
      body: "On no roster in that league. Go claim him.",
    },
    {
      icon: CircleSlash,
      tone: "border-line-accent bg-surface text-ink-subtle",
      title: "Rostered",
      body: "Someone has him. The row names the team and whether he is starting, benched, on IR or on a taxi squad.",
    },
    {
      icon: Search,
      tone: "border-dashed border-line-accent bg-transparent text-ink-subtle",
      title: "Not answered",
      body: "We hold no rosters for that league yet. It is counted in a line under the list rather than called a yes.",
    },
  ];
  return (
    <aside
      aria-labelledby="faf-guide-heading"
      className="h-fit rounded-modal border border-line bg-surface/50 p-4 sm:p-5"
    >
      <h2 id="faf-guide-heading" className="text-sm font-semibold text-ink">
        How to read a result
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        One row per league, with the leagues where he is free at the top.
      </p>
      <ul role="list" className="mt-4 space-y-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.title} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${item.tone}`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  {item.title}
                </span>
                <span className="block text-xs leading-relaxed text-ink-muted">
                  {item.body}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
        <DatabaseZap
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan"
        />
        Sleeper leagues only. Rosters more than an hour old are refreshed before
        the search, up to 12 at a time.
      </p>
    </aside>
  );
}

/**
 * The before and after, drawn. Nine tiles for nine waiver pages against one
 * search box. The tiles are decorative; the two headings and their sentences
 * carry the comparison in words.
 */
function LeagueByLeague() {
  return (
    <section aria-labelledby="faf-compare-heading" className="mt-16">
      <h2
        id="faf-compare-heading"
        className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
      >
        Nine leagues, one Sunday morning
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        A running back gets hurt in the early game and his backup is the name
        everyone is typing. Here is what finding out where he is free costs you.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col rounded-modal border border-line bg-surface/40 p-5 sm:p-6">
          <h3 className="text-base font-semibold text-ink">Inside each app</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Nine leagues means nine waiver pages and the same name searched nine
            times.
          </p>
          <div aria-hidden="true" className="mt-5 grid grid-cols-3 gap-2">
            {Array.from({ length: 9 }, (_, i) => (
              <div
                key={i}
                className="flex h-14 flex-col sm:h-16 justify-between rounded-card border border-line bg-base/60 p-2"
              >
                <span className="h-1.5 w-2/3 rounded-full bg-line-accent" />
                <span className="flex items-center gap-1 text-[10px] text-ink-subtle">
                  <Search className="h-3 w-3" />
                  League {i + 1}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-auto pt-4 font-mono text-sm text-ink-muted">
            <span className="text-lg font-bold text-ink">9</span> searches
          </p>
        </div>
        <div
          className="relative flex flex-col overflow-hidden rounded-modal border border-brand-cyan/40 bg-surface p-5 sm:p-6"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
          }}
        >
          <BeaconHairline />
          <h3 className="text-base font-semibold text-ink">
            With the Free Agent Finder
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            One search. The two leagues where he is free are already at the top.
          </p>
          <div aria-hidden="true" className="mt-5 space-y-2">
            <div className="flex items-center gap-2 rounded-card border border-brand-purple/50 bg-base/60 px-3 py-2.5 text-xs text-ink-muted">
              <Search className="h-3.5 w-3.5 text-brand-cyan" />
              Backup running back
            </div>
            {[true, true, false, false, false].map((free, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 rounded-card border px-3 py-2 text-[11px] ${
                  free
                    ? "border-signal-success/45 bg-signal-success/10 font-semibold text-signal-success"
                    : "border-line bg-base/40 text-ink-subtle"
                }`}
              >
                {free ? (
                  <CircleCheck className="h-3.5 w-3.5" />
                ) : (
                  <CircleSlash className="h-3.5 w-3.5" />
                )}
                {free ? "Free agent" : "Rostered"}
              </div>
            ))}
          </div>
          <p className="mt-auto pt-4 font-mono text-sm text-ink-muted">
            <span className="text-lg font-bold text-brand-cyan">1</span> search
          </p>
        </div>
      </div>
    </section>
  );
}
