import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import Link from "next/link";
import {
  BookOpen,
  Cog,
  ListOrdered,
  Check,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { SITE } from "@/lib/site";
import { serializeJsonLd } from "@/lib/json-ld";
import { TERM_COUNT } from "@/lib/guides/fantasy-football-terms";

export const metadata: Metadata = {
  alternates: { canonical: "/guides" },
  title: "Fantasy Football Guides in Plain English",
  description:
    "What the words actually mean and how to use them, with nothing assumed. Start with the glossary, then take the draft guide into your next draft.",
  ...pageShareMetadata({
    key: "guides",
    title: "Fantasy Football Guides in Plain English",
    description:
      "What the words actually mean and how to use them, with nothing assumed. Start with the glossary, then take the draft guide into your next draft.",
    path: "/guides",
  }),
};

export default async function GuidesPage() {
  // Confirmed Discord members already have the community; point the closing CTA
  // at the live tools instead of the invite.
  const isMember = await isDiscordMember();

  // Every guide on the shelf has a real page, so the ItemList is the shelf. A guide
  // that is still being written is not listed anywhere on this page until it ships
  // (2026-09-14: the "coming soon" card was removed, because an under-construction
  // tile is one of the things Google's publisher policies name, and a promise is
  // not content).
  const published = GUIDES;
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
      <PageBody>
        <Masthead published={published.length} />
        <GuidesSection />
      </PageBody>
      <DiscordCtaSection
        eyebrow="Still have a question"
        heading="Something a guide did not cover? Ask a real person right now."
        body="Drop into our Discord and real fantasy players will walk you through any concept, free, from what a term means to whether a trade is worth making. Want to know how the site itself works? Read about FF Beacon."
        isMember={isMember}
        memberHeading="Read up, then put it to work."
        memberBody="You're already in the crew, so you know where the answers live. The free FF Beacon tools are ready to put everything in these guides to work on your team."
      />
    </main>
  );
}

/* ---------- Masthead ---------- */

/**
 * The headline is one text node now rather than two gradient-split spans, so it
 * needs no aria-label: what a screen reader announces and what the page shows
 * are the same string.
 */
function Masthead({ published }: { published: number }) {
  return (
    <PageMasthead
      eyebrow="Guides"
      title="Fantasy football explained, in plain English."
      description="Long-form explainers that make analytics readable, define every term the first time it shows up, and read the same by eye or by ear."
      stats={[
        { label: "Guides", value: String(published), accent: "cyan" },
        { label: "Terms defined", value: String(TERM_COUNT), accent: "purple" },
        { label: "Cost to read", value: "Free" },
      ]}
    />
  );
}

/* ---------- Guides ---------- */

type Guide = {
  icon: LucideIcon;
  title: string;
  description: string;
  bullets: string[];
  /** The guide's page. A guide without one does not belong on the shelf yet. */
  href: string;
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
    title: "Fantasy football draft guide",
    href: "/guides/fantasy-football-draft-guide",
    description:
      "The players the room is late on, and the ones it is early on, in every format we carry. Rebuilt nightly from our own values, projected points above a replacement starter, and real draft ADP.",
    bullets: [
      "Steals, late-round swings, and fades, per format",
      "A plain-English verdict on every name, not just a number",
      "Tier-based drafting explained in plain English, including how to read a cliff",
      "What to do with the list on draft day, including when your board falls apart",
    ],
  },
  {
    icon: Cog,
    title: "How FF Beacon works",
    href: "/guides/how-ff-beacon-works",
    description:
      "The methodology page: which engine projects a player, how the matchup and reliability adjustments work, what the confidence figure measures, and what none of it accounts for.",
    bullets: [
      "The projection engine, named live rather than hardcoded",
      "The matchup model, built from our own play-by-play back to 2020",
      "The reliability discount and the start/sit confidence figure",
      "What the models do not know, stated plainly",
    ],
  },
];

function GuidesSection() {
  return (
    <section aria-labelledby="guides-heading" className="mt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        The guides shelf
      </p>
      <h2
        id="guides-heading"
        className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
      >
        Start with the vocabulary, then go draft.
      </h2>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted">
        The glossary, the draft guide, and the methodology page are free to
        read right now. Each one defines a term the first time it uses it, so
        you can start anywhere and never hit a word the page assumes you know.
      </p>

      <ul
        className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3"
        role="list"
      >
        {GUIDES.map((guide) => (
          <GuideCard key={guide.title} guide={guide} />
        ))}
      </ul>
    </section>
  );
}

function GuideCard({ guide }: { guide: Guide }) {
  const Icon = guide.icon;
  return (
    <li className="flex">
      {/* The stretched link below draws no outline of its own (it covers the whole
          card, so an outline around it would trace the card edge twice), so the
          keyboard focus ring is drawn on the card via focus-within. Removing an
          outline without a replacement is the one thing the a11y rules never allow. */}
      <article
        className="relative flex w-full flex-col overflow-hidden rounded-card border border-line-accent bg-surface p-6 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan motion-safe:transition-transform motion-safe:hover:-translate-y-0.5"
        style={{
          // Tinted panel plus a real purple glow, the same treatment the closing
          // CTA panels get, so every guide reads as a lit one on the shelf.
          backgroundImage:
            "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
          boxShadow: "0 0 60px -32px rgba(168, 85, 247, 0.75)",
        }}
      >
        {/* Top-edge gradient accent. Decorative. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5"
          style={{
            backgroundImage:
              "linear-gradient(90deg, #A855F7 0%, #22D3EE 100%)",
          }}
        />
        <div className="flex items-start justify-between gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
          >
            <Icon className="h-5 w-5" />
          </span>
          {/* Solid beacon-gradient pill on black text, the same weight as a
              primary button, so "free" is unmistakable at a glance. */}
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-black"
            style={{
              backgroundImage:
                "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            Free to read
          </span>
        </div>
        <h3 className="mt-5 text-lg font-semibold text-ink">
          {/* Stretched link: the heading carries the accessible name and the
              whole card is clickable, but the card contributes exactly one tab
              stop rather than a heading and a duplicate "read more" link. */}
          <Link
            href={guide.href}
            className="after:absolute after:inset-0 after:content-[''] hover:text-brand-cyan focus-visible:outline-none"
          >
            {guide.title}
          </Link>
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {guide.description}
        </p>
        <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
          What you&apos;ll learn
        </p>
        <ul role="list" className="space-y-1.5 text-sm leading-relaxed text-ink">
          {guide.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-2">
              <Check
                aria-hidden="true"
                className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-cyan"
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        {/* Visual affordance only. The stretched link on the heading is the real
            control, so this is hidden from assistive tech to avoid announcing a
            second link that goes to the same place. */}
        <p
          aria-hidden="true"
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-cyan"
        >
          Read the guide
          <ArrowRight className="h-4 w-4" />
        </p>
      </article>
    </li>
  );
}
