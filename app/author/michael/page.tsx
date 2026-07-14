import type { Metadata } from "next";
import { serializeJsonLd } from "@/lib/json-ld";
import Link from "next/link";
import {
  Trophy,
  Layers,
  Calendar,
  Briefcase,
  Sparkles,
  Headphones,
  Mic,
  PenLine,
  type LucideIcon,
} from "lucide-react";
import { SITE } from "@/lib/site";
import { AuthorPortrait } from "@/components/author-portrait";
import { EmailReveal } from "@/components/email-reveal";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { isDiscordMember } from "@/lib/discord-membership";

export const metadata: Metadata = {
  title: "Michael, founder of FF Beacon",
  description:
    "Michael founded FF Beacon to bring accessibility-first fantasy football tools and analytics to everyone, especially players using screen readers.",
};

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
  // Confirmed Discord members already have the community; the Connect section's
  // primary button points them at the toolkit instead of the invite.
  const isMember = await isDiscordMember();
  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(personSchema) }}
      />
      <Hero />
      <StorySection />
      <WhySection />
      <AtAGlanceSection />
      <ToolsSection />
      <SpeakingSection />
      <ConnectSection isMember={isMember} />
    </main>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[720px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.15) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 75%)",
        }}
      />
      {/* Second cyan glow anchored bottom-right for depth, matching About. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 right-0 h-[340px] w-[480px]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(34, 211, 238, 0.10) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto flex max-w-7xl flex-col items-start gap-8 px-4 py-8 sm:flex-row sm:items-center sm:gap-10 sm:px-6 sm:py-20 lg:px-8">
        {/* Beacon gradient ring around the portrait. */}
        <span
          aria-hidden="true"
          className="block shrink-0 rounded-full p-[2px]"
          style={{
            backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
          }}
        >
          <span className="block rounded-full bg-surface p-1">
            <AuthorPortrait size={176} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Author
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Michael
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-ink-muted">
            Founder of FF Beacon. Twenty seasons in fantasy. An active dynasty
            manager who plays the game stats-first — and finally got tired of
            fantasy tools that weren&rsquo;t built for him.
          </p>
          <ul
            className="mt-6 grid grid-cols-3 gap-2 sm:gap-3"
            role="list"
            aria-label="Quick facts"
          >
            <HeroStat value="20+" label="Seasons" />
            <HeroStat value="Dynasty" label="Format focus" />
            <HeroStat value="2006" label="Started" />
          </ul>
        </div>
      </div>
    </header>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <li
      className="group relative overflow-hidden rounded-card border border-line bg-surface/60 px-3 py-2 transition-colors hover:border-line-accent"
      style={{ boxShadow: "0 0 40px -36px rgba(168, 85, 247, 0.6)" }}
    >
      <AccentStrip />
      <p
        className="bg-clip-text font-mono text-xl font-bold tabular-nums text-transparent sm:text-2xl"
        style={{
          backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
        }}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </p>
    </li>
  );
}

/* ---------- Story ---------- */

function StorySection() {
  return (
    <section
      aria-labelledby="story-heading"
      className="border-b border-line"
    >
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="grid gap-8 md:grid-cols-[1fr_2fr] md:gap-12 lg:gap-16">
          <div>
            <SectionEyebrow>Story</SectionEyebrow>
            <h2
              id="story-heading"
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              How I learned to play fantasy stats-first.
            </h2>
          </div>
          <div className="relative space-y-5 text-lg leading-relaxed text-ink-muted md:pl-8">
            <ProseRule />
            <p>
              I&rsquo;ve been playing fantasy football since 2006 — twenty
              seasons. For most of those years I ran one or two leagues. In 2023
              I jumped into dynasty, and within a year I was managing more
              rosters than I could keep in my head. The unlock wasn&rsquo;t free
              time. It was finally learning how to actually use the data.
            </p>
            <p>
              I&rsquo;m blind. That cuts both ways in fantasy. Every app I tried
              had friction sighted users never notice — stats trapped inside an
              unlabeled chart, filters you can only reach with a mouse, player
              news that updates silently. So I leaned on what does work for me:
              stat lines, target shares, snap counts, analyst tape breakdowns on
              audio, and advanced metrics that travel well as text.
            </p>
            <p>
              That accidentally made me a better fantasy player. I was already
              evaluating players the way successful managers do — numbers and
              tape first, vibes last.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Why ---------- */

function WhySection() {
  return (
    <section
      aria-labelledby="why-heading"
      className="relative border-b border-line bg-surface/30"
    >
      <BeaconHairline />
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="grid gap-8 md:grid-cols-[1fr_2fr] md:gap-12 lg:gap-16">
          <div>
            <SectionEyebrow>Why FF Beacon</SectionEyebrow>
            <h2
              id="why-heading"
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              The product I wish existed when I started.
            </h2>
          </div>
          <div className="relative space-y-5 text-lg leading-relaxed text-ink-muted md:pl-8">
            <ProseRule />
            <p>
              Two things were obvious. First, there&rsquo;s a massive gap in
              fantasy resources for people who don&rsquo;t already speak
              analytics. Second, almost nothing was built for fantasy players
              who use a screen reader.
            </p>
            <p>
              FF Beacon is my attempt to close both at once. Every component is
              checked against keyboard navigation, semantic HTML, and screen
              reader announcements before it ships. Every guide explains the
              analytic before it asks you to use it.
            </p>
            <p>
              If you&rsquo;ve ever felt locked out of fantasy football by the
              jargon or the interface — this site is for you. Read it by ear or
              by eye. It works both ways.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- At a glance ---------- */

function AtAGlanceSection() {
  return (
    <section
      aria-labelledby="ataglance-heading"
      className="border-b border-line"
    >
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <SectionEyebrow>At a glance</SectionEyebrow>
        <h2
          id="ataglance-heading"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          The short version.
        </h2>
        <ul
          className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          role="list"
        >
          <FactCard
            icon={Trophy}
            accent="cyan"
            value="20 seasons"
            label="Of fantasy football, starting 2006"
          />
          <FactCard
            icon={Layers}
            accent="purple"
            value="Multi-format"
            label="Redraft, dynasty, best ball, chop/guillotine, auction/contract, and exploring more on the daily."
          />
          <FactCard
            icon={Calendar}
            accent="cyan"
            value="20+ seasons in fantasy"
            label="Drafted my first team on dial-up. Still chasing the edge."
          />
          <FactCard
            icon={Briefcase}
            accent="purple"
            value="Marketing + dev"
            label="Day-job background powering the build"
          />
        </ul>
      </div>
    </section>
  );
}

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
  return (
    <li
      className="group relative overflow-hidden rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-accent motion-safe:transition-transform motion-safe:hover:-translate-y-0.5"
      style={{ boxShadow: "0 0 48px -42px rgba(168, 85, 247, 0.6)" }}
    >
      <AccentStrip />
      <IconBadge icon={Icon} accent={accent} size="md" />
      <p className="mt-3 text-base font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{label}</p>
    </li>
  );
}

/* ---------- Tools I rely on ---------- */

function ToolsSection() {
  return (
    <section
      aria-labelledby="tools-heading"
      className="relative border-b border-line bg-surface/30"
    >
      <BeaconHairline />
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <SectionEyebrow>Tools I rely on</SectionEyebrow>
        <h2
          id="tools-heading"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          The stack behind every roster decision.
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
          The apps, assistive tech, and audio I lean on every week to stay sharp.
        </p>

        <ul
          className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
        >
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
            body="My daily driver across every interface. Free, open-source, and built by the community that actually depends on it."
          />
          <ToolCard
            icon={Mic}
            accent="purple"
            title="Podcasts & tape shows"
            body="A daily rotation of redraft, dynasty, and best ball shows because tape breakdowns travel better by ear than by chart."
          />
        </ul>
      </div>
    </section>
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
  const accentColor = accent === "purple" ? "#A855F7" : "#22D3EE";
  return (
    <li
      className="group relative flex flex-col overflow-hidden rounded-modal border border-line bg-surface p-5 transition-colors hover:border-line-accent motion-safe:transition-transform motion-safe:hover:-translate-y-0.5"
      style={{ boxShadow: `0 0 64px -46px ${accentColor}99` }}
    >
      {/* Corner glow tinted to the card accent. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full"
        style={{
          background: `radial-gradient(circle, ${accentColor}24 0%, transparent 70%)`,
        }}
      />
      <div className="relative flex flex-1 flex-col">
        <IconBadge icon={Icon} accent={accent} size="md" />
        <h3 className="mt-3 text-base font-semibold text-ink">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
      </div>
    </li>
  );
}

/* ---------- Speaking & Writing ---------- */

function SpeakingSection() {
  return (
    <section
      aria-labelledby="speaking-heading"
      className="border-b border-line"
    >
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <SectionEyebrow>Speaking & Writing</SectionEyebrow>
        <h2
          id="speaking-heading"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Conversations, articles, appearances.
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
          As guest spots, podcasts, and pieces accumulate, they&rsquo;ll live
          here. Replace this placeholder with a list as it fills out.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <PlaceholderCard
            icon={Mic}
            title="Podcast appearances"
            body="Coming soon. Want to feature this story on your show? Reach out via the contact link below."
          />
          <PlaceholderCard
            icon={PenLine}
            title="Written pieces"
            body="Coming soon. Articles on accessibility-first fantasy and analytics-first roster building will land here as they ship."
          />
        </div>
      </div>
    </section>
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
    <article className="group relative overflow-hidden rounded-card border border-dashed border-line bg-base/40 p-5 transition-colors hover:border-line-accent">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-card border border-dashed border-line bg-surface text-ink-muted transition-colors group-hover:text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="mt-3 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
    </article>
  );
}

/* ---------- Connect / CTA ---------- */

function ConnectSection({ isMember }: { isMember: boolean }) {
  return (
    <section aria-labelledby="connect-heading">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-line bg-surface p-8 sm:p-10"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
          }}
        >
          {/* Top hairline so the closing panel feels like a lit beacon. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
            }}
          />
          <div className="relative">
            <SectionEyebrow>Connect</SectionEyebrow>
            <h2
              id="connect-heading"
              className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              Want to talk about accessibility, fantasy, or analytics?
            </h2>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
              {isMember
                ? "You're already in the Discord, so you know where to find the community, myself included. Prefer a direct line? Email works too, and everything I've built is free to use whenever you want to dig in."
                : "Our Discord is the fastest way to reach the whole community, myself included. Prefer a direct line? Email works too, and the social accounts in the footer will start posting as the site grows."}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <MemberHeroCta
                isMember={isMember}
                size="md"
                memberMode="link"
                memberHref="/tools"
                memberLabel="Explore our fantasy tools"
                memberIcon="tools"
              />
              <EmailReveal variant="secondary" />
              <Link
                href="/about"
                className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-ink-muted hover:text-ink"
              >
                Read about FF Beacon
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Shared ---------- */

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}

/* Beacon gradient hairline pinned to the top edge of a section, used to set
   the tinted-background panels apart from their neighbours. */
function BeaconHairline() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-0 h-px"
      style={{
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
      }}
    />
  );
}

/* Left-edge vertical gradient accent strip, the shared card motif used across
   the rankings status tiles and Signal Check. */
function AccentStrip() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 left-0 w-px"
      style={{
        backgroundImage:
          "linear-gradient(180deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
      }}
    />
  );
}

/* Vertical gradient rule that runs alongside a prose column on desktop. Adds
   the beacon accent to the long-form sections without altering the copy. */
function ProseRule() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-1 left-0 hidden w-px md:block"
      style={{
        backgroundImage:
          "linear-gradient(180deg, transparent 0%, #A855F7 20%, #22D3EE 80%, transparent 100%)",
      }}
    />
  );
}

/* Tinted icon chip. Decorative: the icon is aria-hidden and the surrounding
   heading carries the accessible name. */
function IconBadge({
  icon: Icon,
  accent,
  size = "md",
  rounded = false,
}: {
  icon: LucideIcon;
  accent: "purple" | "cyan";
  size?: "md" | "lg";
  rounded?: boolean;
}) {
  const c = accent === "purple" ? "#A855F7" : "#22D3EE";
  const box = size === "lg" ? "h-11 w-11" : "h-10 w-10";
  const glyph = size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span
      aria-hidden="true"
      className={`flex ${box} items-center justify-center border ${
        rounded ? "rounded-full" : "rounded-card"
      }`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${c}26 0%, ${c}0D 100%)`,
        borderColor: `${c}59`,
        color: c,
      }}
    >
      <Icon className={glyph} />
    </span>
  );
}
