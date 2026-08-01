import type { Metadata } from "next";
import Link from "next/link";
import {
  Accessibility,
  BookOpen,
  ListOrdered,
  Check,
  Clock,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import { HeroLavaField } from "@/components/hero-lava-field";
import { SITE } from "@/lib/site";
import { serializeJsonLd } from "@/lib/json-ld";
import { TERM_COUNT } from "@/lib/guides/fantasy-football-terms";

export const metadata: Metadata = {
  alternates: { canonical: "/guides" },
  title: "Fantasy Football Guides",
  description: `Plain-English fantasy football guides. Start with the glossary: ${TERM_COUNT} terms defined, from PPR and superflex to target share and aDOT.`,
};

export default async function GuidesPage() {
  // Confirmed Discord members already have the community; point the closing CTA
  // at the live tools instead of the invite.
  const isMember = await isDiscordMember();

  // Only published guides go in the ItemList. Advertising a "coming soon" card as
  // a list item would point structured data at a page that does not exist.
  const published = GUIDES.filter((g) => g.href);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Fantasy Football Guides",
      description:
        "Long-form fantasy football explainers from FF Beacon, written in plain English and built to read the same by eye or by screen reader.",
      url: `${SITE.url}/guides`,
      inLanguage: "en-US",
      isPartOf: { "@type": "WebSite", name: SITE.name, url: SITE.url },
      mainEntity: {
        "@type": "ItemList",
        itemListElement: published.map((guide, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: guide.title,
          url: `${SITE.url}${guide.href}`,
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        {
          "@type": "ListItem",
          position: 2,
          name: "Guides",
          item: `${SITE.url}/guides`,
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
      <Hero />
      <GuidesSection />
      <DiscordCtaSection
        eyebrow="While you wait"
        heading="Waiting on a guide? Ask a real person right now."
        body="The glossary is live and the rest are being written while we build out the platform. In the meantime, drop into our Discord and real fantasy players will walk you through any concept, free. Want to know what's already live? Read about FF Beacon."
        isMember={isMember}
        memberHeading="While the rest cook, explore the tools."
        memberBody="You're already in the crew, so hang tight on the guides still being written. In the meantime, the free FF Beacon tools are live and ready to put to work on your team."
      />
    </main>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  return (
    <header className="relative -mt-[4.5rem] overflow-hidden border-b border-line">
      {/* Beacon-gradient accent bar pinned to the very top. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-10 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <HeroLavaField copy="left" />
      <div className="relative mt-[4.5rem] mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-24 lg:px-8">
        {/* aria-label collapses the gradient-split headline into one
            accessible name for screen-reader navigation. */}
        <h1
          aria-label="Fantasy football explained, in plain English."
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl"
        >
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            Fantasy football explained
          </span>
          , in plain English.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Long-form explainers that make analytics readable, define every
          term the first time it shows up, and read the same by eye or by
          ear.
        </p>
      </div>
    </header>
  );
}

/* ---------- Guides ---------- */

type Guide = {
  icon: LucideIcon;
  title: string;
  description: string;
  bullets: string[];
  /** Present once the guide has a real page. Absent means it is still being written. */
  href?: string;
};

const GUIDES: Guide[] = [
  {
    icon: BookOpen,
    title: "Fantasy football terms 101",
    href: "/guides/fantasy-football-terms",
    description:
      "Every word your league chat assumes you already know. PPR, superflex, FAAB, aDOT, and the rest, each defined in one sentence and then explained properly.",
    bullets: [
      `${TERM_COUNT} terms grouped by where you actually run into them`,
      "What the analytics measure: target share, snap share, yards per route run",
      "Straight answers to what PPR, superflex, and dynasty really change",
    ],
  },
  {
    icon: ListOrdered,
    title: "2026 fantasy football draft guide",
    description:
      "Everything worth knowing before you go on the clock this year. Strategy by format, the sleepers worth a late pick, the value the room keeps passing on, and the names we're staying away from.",
    bullets: [
      "Draft plans that hold up in PPR, superflex, and dynasty",
      "Sleepers, value picks, and the players we're fading in 2026",
      "Round-by-round targets, and what to do when your board falls apart",
    ],
  },
  {
    icon: Accessibility,
    title: "Accessible fantasy football",
    description:
      "The first-of-its-kind reference for fantasy players who use a screen reader. Apps that work, habits that save time, and what to look for before signing up with a host site.",
    bullets: [
      "Apps and tools that pair cleanly with NVDA, JAWS, and VoiceOver",
      "Weekly habits that make lineup setting and waiver claims faster",
      "How to evaluate a fantasy host site before you commit",
    ],
  },
];

function GuidesSection() {
  return (
    <section
      aria-labelledby="guides-heading"
      className="border-b border-line bg-surface/30"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          The guides shelf
        </p>
        <h2
          id="guides-heading"
          className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Start with the vocabulary.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted">
          The glossary is live and free to read right now. The other two are
          being written while we focus on the rest of the platform, and
          they&apos;ll land here as they&apos;re ready.
        </p>

        <ul
          className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3"
          role="list"
        >
          {GUIDES.map((guide) => (
            <GuideCard key={guide.title} guide={guide} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function GuideCard({ guide }: { guide: Guide }) {
  const Icon = guide.icon;
  const isLive = Boolean(guide.href);
  return (
    <li className="flex">
      {/* The stretched link below draws no outline of its own (it covers the whole
          card, so an outline around it would trace the card edge twice), so the
          keyboard focus ring is drawn on the card via focus-within. Removing an
          outline without a replacement is the one thing the a11y rules never allow. */}
      <article
        className={
          isLive
            ? "relative flex w-full flex-col overflow-hidden rounded-card border border-line-accent bg-surface p-6 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan motion-safe:transition-transform motion-safe:hover:-translate-y-0.5"
            : // No hover state on a pending card. A border that lights up on
              // hover reads as "this is clickable", and this one is not.
              "relative flex w-full flex-col overflow-hidden rounded-card border border-dashed border-line bg-base/40 p-6"
        }
        style={
          isLive
            ? {
                // Tinted panel plus a real purple glow, the same treatment the
                // closing CTA panels get, so the published guide reads as the
                // lit one on the shelf.
                backgroundImage:
                  "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
                boxShadow: "0 0 60px -32px rgba(168, 85, 247, 0.75)",
              }
            : undefined
        }
      >
        {/* Top-edge gradient accent. Only the published guide gets it; on a
            pending card it would read as "featured" and undo the distinction. */}
        {isLive && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-0.5"
            style={{
              backgroundImage:
                "linear-gradient(90deg, #A855F7 0%, #22D3EE 100%)",
            }}
          />
        )}
        <div className="flex items-start justify-between gap-3">
          <span
            aria-hidden="true"
            className={
              isLive
                ? "flex h-11 w-11 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
                : "flex h-11 w-11 items-center justify-center rounded-card border border-dashed border-line bg-surface text-ink-muted"
            }
          >
            <Icon className="h-5 w-5" />
          </span>
          {isLive ? (
            // Solid beacon-gradient pill on black text, the same weight as a
            // primary button, so "live" is unmistakable at a glance.
            <span
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-black"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
              }}
            >
              Live now
            </span>
          ) : (
            // Neutral, not cyan. A brand-colored badge reads as active, which is
            // the opposite of what this one means.
            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line bg-base px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              <Clock aria-hidden="true" className="h-3 w-3" />
              Coming soon
            </span>
          )}
        </div>
        <h3
          className={`mt-5 text-lg font-semibold ${
            isLive ? "text-ink" : "text-ink-muted"
          }`}
        >
          {guide.href ? (
            // Stretched link: the heading carries the accessible name and the
            // whole card is clickable, but the card contributes exactly one tab
            // stop rather than a heading and a duplicate "read more" link.
            <Link
              href={guide.href}
              className="after:absolute after:inset-0 after:content-[''] hover:text-brand-cyan focus-visible:outline-none"
            >
              {guide.title}
            </Link>
          ) : (
            guide.title
          )}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {guide.description}
        </p>
        <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
          {isLive ? "What you'll learn" : "What it will cover"}
        </p>
        {/* Pending cards step the bullet text down one level (ink-muted is still
            about 9:1 on this background, comfortably past AA) so they read as
            recessed without any of the copy becoming hard to read. Nothing is
            hidden and no text drops below contrast. */}
        <ul
          role="list"
          className={`space-y-1.5 text-sm leading-relaxed ${
            isLive ? "text-ink" : "text-ink-muted"
          }`}
        >
          {guide.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-2">
              <Check
                aria-hidden="true"
                className={`mt-1 h-3.5 w-3.5 shrink-0 ${
                  isLive ? "text-brand-cyan" : "text-ink-subtle"
                }`}
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        {isLive && (
          // Visual affordance only. The stretched link on the heading is the real
          // control, so this is hidden from assistive tech to avoid announcing a
          // second link that goes to the same place.
          <p
            aria-hidden="true"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-cyan"
          >
            Read the guide
            <ArrowRight className="h-4 w-4" />
          </p>
        )}
      </article>
    </li>
  );
}
