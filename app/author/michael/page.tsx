import type { Metadata } from "next";
import { serializeJsonLd } from "@/lib/json-ld";
import Link from "next/link";
import {
  BarChart3,
  Briefcase,
  Calendar,
  Headphones,
  Info,
  Layers,
  Mic,
  Newspaper,
  PenLine,
  Radar,
  Scale,
  Sparkles,
  Timer,
  Trophy,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { SITE } from "@/lib/site";
import { AuthorPortrait } from "@/components/author-portrait";
import { ContactPanel } from "@/components/contact-panel";
import { EmailReveal } from "@/components/email-reveal";
import { LinkTile } from "@/components/link-tile";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { Panel } from "@/components/dashboard-panel";
import { isDiscordMember } from "@/lib/discord-membership";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead } from "@/components/app-shell/page-masthead";

export const metadata: Metadata = {
  alternates: { canonical: "/author/michael" },
  title: "Michael, founder of FF Beacon",
  description:
    "Michael founded FF Beacon to bring accessibility-first fantasy football tools and analytics to everyone, especially players using screen readers.",
};

/**
 * /author/michael
 *
 * The byline page every article and guide on the site points at, which makes it
 * the page Google reads to decide whether the author behind them is a real
 * person with real standing. It carries the Person schema, the visible
 * biography that schema claims, and links to the work itself.
 *
 * Laid out as a dashboard rather than a marketing page: a masthead, panels down
 * the main column, and a rail holding a message form and the ways to reach him.
 */

const personSchema = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Michael",
  jobTitle: "Founder, FF Beacon",
  description:
    "Twenty-year fantasy football player and blind dynasty manager who plays the game stats-first.",
  url: `${SITE.url}/author/michael`,
  worksFor: {
    "@type": "Organization",
    name: SITE.name,
    url: SITE.url,
  },
  knowsAbout: [
    "Fantasy Football",
    "Dynasty Fantasy Football",
    "Best Ball",
    "Advanced Football Analytics",
    "Accessibility",
    "Screen Reader UX",
  ],
};

export default async function AuthorMichaelPage() {
  // Confirmed Discord members already have the community; the rail's primary
  // button points them at the toolkit instead of the invite.
  const isMember = await isDiscordMember();

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(personSchema) }}
      />

      <PageBody flush>
        <PageMasthead
          eyebrow="Author"
          title="Michael"
          description="Founder of FF Beacon. Twenty seasons in fantasy, an active dynasty manager who plays the game stats-first, and the reason this site is built the way it is."
          stats={[
            { label: "Seasons", value: "20+", detail: "Since 2006", accent: "purple" },
            { label: "Format focus", value: "Dynasty", detail: "Superflex and TEP", accent: "cyan" },
            { label: "Reads by", value: "Ear", detail: "Screen reader, daily", accent: "purple" },
          ]}
        >
          <span
            aria-hidden="true"
            className="block w-fit rounded-full p-[2px]"
            style={{
              backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            <span className="block rounded-full bg-surface p-1">
              <AuthorPortrait size={112} />
            </span>
          </span>
        </PageMasthead>
      </PageBody>

      <PageColumns
        railLabel="Contact Michael and related links"
        rail={
          <>
            <ContactPanel
              pageKey="author"
              eyebrow="Contact"
              title="Message Michael"
              helper="Questions about the site, the data, or accessibility. It reaches the same inbox he reads every day."
              promptLabel="Your message"
              placeholder="What would you like to ask?"
            />

            <Panel eyebrow="Connect" title="Other ways to reach me" headingLevel={2}>
              <p className="text-sm leading-relaxed text-ink-muted">
                {isMember
                  ? "You are already in the Discord, so you know where to find the community and me in it. Email works for anything longer."
                  : "The Discord is the fastest way to reach the whole community, me included. Email works for anything longer."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MemberHeroCta
                  isMember={isMember}
                  size="md"
                  memberMode="link"
                  memberHref="/tools"
                  memberLabel="Explore the tools"
                  memberIcon="tools"
                />
                <EmailReveal variant="secondary" />
              </div>
            </Panel>

            <Panel eyebrow="Read next" title="Where to go from here" headingLevel={2}>
              <div className="grid gap-2">
                <LinkTile
                  href="/about"
                  icon={Info}
                  title="About FF Beacon"
                  body="What the site is, how it is built, and where the numbers come from."
                />
                <LinkTile
                  href="/guides/fantasy-football-terms"
                  icon={Newspaper}
                  title="The glossary"
                  body="Every fantasy term that does real work, defined in one sentence each."
                  accent="purple"
                />
              </div>
            </Panel>
          </>
        }
      >
        <Panel
          eyebrow="Story"
          title="How I learned to play fantasy stats-first"
          glow
        >
          <div className="space-y-4 text-sm leading-relaxed text-ink-muted sm:text-base">
            <p>
              I have been playing fantasy football since 2006, twenty seasons. For most
              of those years I ran one or two leagues. In 2023 I jumped into dynasty,
              and within a year I was managing more rosters than I could keep in my
              head. The unlock was not free time. It was finally learning how to
              actually use the data.
            </p>
            <p>
              I am blind. That cuts both ways in fantasy. Every app I tried had friction
              sighted users never notice: stats trapped inside an unlabeled chart,
              filters you can only reach with a mouse, player news that updates
              silently. So I leaned on what does work for me. Stat lines, target shares,
              snap counts, analyst tape breakdowns on audio, and advanced metrics that
              travel well as text.
            </p>
            <p>
              That accidentally made me a better fantasy player. I was already
              evaluating players the way successful managers do, numbers and tape first,
              vibes last.
            </p>
          </div>
        </Panel>

        <Panel eyebrow="Why FF Beacon" title="The product I wish existed when I started">
          <div className="space-y-4 text-sm leading-relaxed text-ink-muted sm:text-base">
            <p>
              Two things were obvious. There is a large gap in fantasy resources for
              people who do not already speak analytics, and almost nothing was built
              for fantasy players who use a screen reader.
            </p>
            <p>
              FF Beacon closes both at once. Every component is checked against keyboard
              navigation, semantic HTML, and screen reader announcements before it
              ships. Every guide explains the analytic before it asks you to use it. No
              column is hidden on a phone to make a table easier to lay out, because the
              data you can reach on a laptop is the data you should be able to reach in
              a draft.
            </p>
            <p>
              If you have ever felt locked out of fantasy football by the jargon or the
              interface, this site is for you. Read it by ear or by eye. It works both
              ways.
            </p>
          </div>
        </Panel>

        <Panel
          eyebrow="The work"
          title="What I have built here"
          helper="Every one of these is free, and every one started as something I needed for my own leagues."
        >
          <div className="grid gap-2 lg:grid-cols-2">
            <LinkTile
              href="/rankings"
              icon={BarChart3}
              title="Rankings board"
              body="Values, tiers, and seven-day movement for every format, from a source you choose."
            />
            <LinkTile
              href="/tools/league-pulse"
              icon={Workflow}
              title="Sleeper League Pulse"
              body="Sync a Sleeper league and read every roster, trade, and waiver move in it."
              accent="purple"
            />
            <LinkTile
              href="/tools/on-the-clock"
              icon={Timer}
              title="On The Clock"
              body="A live draft room that says who is falling while the clock is still running."
            />
            <LinkTile
              href="/tools/signal-check"
              icon={Scale}
              title="Signal Check"
              body="Trade grades that state the margin and the confidence rather than a letter."
              accent="purple"
            />
            <LinkTile
              href="/brief"
              icon={Newspaper}
              title="The Beacon Brief"
              body="The news desk, written so the roster impact is in the first line."
            />
            <LinkTile
              href="/games/signal-scout"
              icon={Radar}
              title="Signal Scout"
              body="A guessing game built on real player profiles, and the one thing here that is purely for fun."
              accent="purple"
            />
          </div>
        </Panel>

        <Panel eyebrow="At a glance" title="The short version">
          <ul role="list" className="grid gap-2 sm:grid-cols-2">
            <FactCard
              icon={Trophy}
              accent="cyan"
              value="20 seasons"
              label="Of fantasy football, starting in 2006"
            />
            <FactCard
              icon={Layers}
              accent="purple"
              value="Multi-format"
              label="Redraft, dynasty, best ball, guillotine, and auction leagues"
            />
            <FactCard
              icon={Calendar}
              accent="cyan"
              value="Dial-up era"
              label="Drafted the first team on it. Still chasing the edge"
            />
            <FactCard
              icon={Briefcase}
              accent="purple"
              value="Marketing and dev"
              label="The day-job background powering the build"
            />
          </ul>
        </Panel>

        <Panel
          eyebrow="Tools I rely on"
          title="The stack behind every roster decision"
          helper="What I lean on each week to stay sharp."
        >
          <ul role="list" className="grid gap-2 lg:grid-cols-3">
            <ToolCard
              icon={Sparkles}
              accent="purple"
              title="Sleeper"
              body="Where my leagues live. Public APIs make it the only host worth syncing against."
            />
            <ToolCard
              icon={Headphones}
              accent="cyan"
              title="NVDA"
              body="My daily driver across every interface. Free, open source, and built by the people who depend on it."
            />
            <ToolCard
              icon={Mic}
              accent="purple"
              title="Podcasts and tape shows"
              body="A daily rotation of redraft, dynasty, and best ball shows, because tape travels better by ear than by chart."
            />
          </ul>
        </Panel>

        <Panel
          eyebrow="Elsewhere"
          title="Speaking and writing"
          helper="Guest spots and articles will be listed here as they happen."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <PlaceholderCard
              icon={Mic}
              title="Podcast appearances"
              body="Nothing to list yet. Running a show and want this story on it? The message form in the rail reaches me."
            />
            <PlaceholderCard
              icon={PenLine}
              title="Written pieces"
              body="Nothing to list yet. Pieces on accessibility-first fantasy and analytics-first roster building will land here as they ship."
            />
          </div>
        </Panel>

        <Panel eyebrow="Connect" title="Want to talk about accessibility, fantasy, or analytics?">
          <p className="text-sm leading-relaxed text-ink-muted">
            The message form in the rail lands in the same queue I read every day. If
            you would rather talk it through with more than one person, the Discord is
            full of fantasy players who will help you turn a question into a lineup
            decision, free.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <MemberHeroCta
              isMember={isMember}
              size="md"
              memberMode="link"
              memberHref="/tools"
              memberLabel="Explore our fantasy tools"
              memberIcon="tools"
            />
            <Link
              href="/about"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <Users aria-hidden="true" className="h-4 w-4" />
              Read about FF Beacon
            </Link>
          </div>
        </Panel>
      </PageColumns>
    </main>
  );
}

/* ---------- Pieces ---------- */

function FactCard({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  accent: "purple" | "cyan";
}) {
  const color = accent === "purple" ? "#A855F7" : "#22D3EE";
  return (
    <li className="relative overflow-hidden rounded-card border border-line bg-base/50 p-4">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-px"
        style={{
          backgroundImage: `linear-gradient(180deg, transparent 0%, ${color} 30%, ${color}66 70%, transparent 100%)`,
        }}
      />
      <IconChip icon={Icon} color={color} />
      <p className="mt-3 text-base font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{label}</p>
    </li>
  );
}

function ToolCard({
  icon: Icon,
  title,
  body,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  accent: "purple" | "cyan";
}) {
  const color = accent === "purple" ? "#A855F7" : "#22D3EE";
  return (
    <li
      className="relative overflow-hidden rounded-card border border-line bg-base/50 p-4"
      style={{ boxShadow: `0 0 64px -48px ${color}99` }}
    >
      <IconChip icon={Icon} color={color} />
      <h3 className="mt-3 text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

function PlaceholderCard({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-card border border-dashed border-line bg-base/40 p-4">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-card border border-dashed border-line bg-surface text-ink-muted"
      >
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </article>
  );
}

/** Tinted icon chip. Decorative: the heading beside it carries the name. */
function IconChip({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 items-center justify-center rounded-card border"
      style={{
        backgroundImage: `linear-gradient(135deg, ${color}26 0%, ${color}0D 100%)`,
        borderColor: `${color}59`,
        color,
      }}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}
