import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import Link from "next/link";
import {
  Workflow,
  Calculator,
  Scale,
  Swords,
  Timer,
  UserSearch,
  ArrowRight,
  Gamepad2,
  Accessibility,
  BookOpen,
  Sliders,
  Check,
  type LucideIcon,
} from "lucide-react";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { isDiscordMember } from "@/lib/discord-membership";
import {
  TOOL_CATALOG,
  type ToolCatalogEntry,
  type ToolHref,
} from "@/lib/tools-catalog";

export const metadata: Metadata = {
  alternates: { canonical: "/tools" },
  title: "Free Fantasy Football Tools",
  description:
    "Sync your Sleeper leagues, get help live in the draft, find out if a trade is fair, compare two players, and know what to bid on waivers. Free, no signup, redraft and dynasty.",
  ...pageShareMetadata({
    key: "tools",
    title: "Free Fantasy Football Tools",
    description:
      "Sync your Sleeper leagues, get help live in the draft, find out if a trade is fair, compare two players, and know what to bid on waivers. Free, no signup, redraft and dynasty.",
    path: "/tools",
  }),
};

export default async function ToolsPage() {
  // Confirmed Discord members are already in the community, and linking them
  // back to /tools from the tools page is circular, so we point them at the
  // newly launched free games instead.
  const isMember = await isDiscordMember();
  return (
    <main id="main">
      <PageBody>
        <Masthead isMember={isMember} />
        {TOOLS.map((tool, i) => (
          <ToolSection key={tool.href} tool={tool} tinted={i % 2 === 1} />
        ))}
        <PrinciplesSection />
        <CtaSection isMember={isMember} />
      </PageBody>
    </main>
  );
}

/* ---------- Masthead ---------- */

function Masthead({ isMember }: { isMember: boolean }) {
  return (
    <PageMasthead
      eyebrow="Tools"
      title="Every tool you need, none of the noise."
      description="Real Sleeper league sync, live draft help, trade grades, and confident waiver bids in one place. All built to work the same by eye or by ear."
      stats={[{ label: "Tools", value: String(TOOLS.length), accent: "cyan" }]}
      actions={
        <>
          <MemberHeroCta
            isMember={isMember}
            size="lg"
            memberMode="link"
            memberHref="/games"
            memberLabel="Explore our free games"
            memberIcon="games"
          />
          <Link
            href="/rankings"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            View player rankings
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </>
      }
    />
  );
}

/* ---------- Tools ---------- */

/** The catalog entry plus the icon the page draws for it. Icons are resolved
 *  here, keyed by href, so lib/tools-catalog.ts stays presentation-free and the
 *  llms.txt routes can read the same descriptions without pulling in lucide. */
type Tool = ToolCatalogEntry & { icon: LucideIcon };

const TOOL_ICONS: Record<ToolHref, LucideIcon> = {
  "/tools/league-pulse": Workflow,
  "/tools/on-the-clock": Timer,
  "/tools/manager-pulse": UserSearch,
  "/tools/beacon-breakdown": Swords,
  "/tools/signal-check": Scale,
  "/tools/faab": Calculator,
};

const TOOLS: Tool[] = TOOL_CATALOG.map((tool) => ({
  ...tool,
  icon: TOOL_ICONS[tool.href],
}));

function ToolSection({ tool, tinted }: { tool: Tool; tinted: boolean }) {
  const headingId = `tool-${tool.href.replace(/\//g, "-").replace(/^-+/, "")}-heading`;
  const Icon = tool.icon;
  return (
    <section
      aria-labelledby={headingId}
      className={`-mx-4 border-b border-line px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 ${
        tinted ? "bg-surface/30" : ""
      }`}
    >
      <div className="py-12 sm:py-16">
        <div className="grid gap-8 md:grid-cols-[1fr_2fr] md:gap-12 lg:gap-16">
          <div>
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
            >
              <Icon className="h-7 w-7" />
            </span>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              {tool.eyebrow}
            </p>
            {/* The heading is the link. This page is the strongest internal
                pointer each tool page has, and the only anchor text it used to
                offer was the button below, which says "Analyze a trade" or
                "Run a bid": true, but it names no destination. A heading link
                gives the tool's real name to a crawler and, more to the point,
                to anyone tabbing through links or pulling up a links list. */}
            <h2
              id={headingId}
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              <Link
                href={tool.href}
                className="rounded-sm transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan"
              >
                {tool.title}
              </Link>
            </h2>
          </div>
          <div className="space-y-6">
            <p className="text-lg leading-relaxed text-ink-muted">{tool.pitch}</p>
            <ul
              role="list"
              className="space-y-2.5 text-base leading-relaxed text-ink"
            >
              {tool.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-2.5">
                  <Check
                    aria-hidden="true"
                    className="mt-1 h-4 w-4 shrink-0 text-brand-cyan"
                  />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <Link
              href={tool.href}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {tool.cta}
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- What every tool gets right ---------- */

function PrinciplesSection() {
  return (
    <section
      aria-labelledby="principles-heading"
      className="-mx-4 border-b border-line px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="py-12 sm:py-16">
        <SectionEyebrow>What every tool gets right</SectionEyebrow>
        <h2
          id="principles-heading"
          className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Different jobs. Same standards.
        </h2>

        <ul
          className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
        >
          <PrincipleCard
            icon={Accessibility}
            title="Screen-reader native"
            body="Every control is keyboard-navigable and announces clearly. No traps, no silent updates, no chart that won't read aloud."
          />
          <PrincipleCard
            icon={BookOpen}
            title="Plain English first"
            body="The metric is defined in the same view where you use it. No insider vocabulary, no analytics gatekeeping."
          />
          <PrincipleCard
            icon={Sliders}
            title="Your league, your settings"
            body="Pick your scoring format and ranking source once. Every tool on the site follows along automatically."
          />
        </ul>
      </div>
    </section>
  );
}

function PrincipleCard({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-card border border-line bg-base/60 p-5 transition-colors hover:border-line-accent">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

/* ---------- CTA ---------- */

function CtaSection({ isMember }: { isMember: boolean }) {
  return (
    <section aria-labelledby="cta-heading">
      <div className="py-12 sm:py-16">
        <div
          className="relative overflow-hidden rounded-modal border border-line bg-surface p-8 sm:p-10"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
          }}
        >
          <SectionEyebrow>
            {isMember ? "New: free games" : "More on the way"}
          </SectionEyebrow>
          <h2
            id="cta-heading"
            className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            {isMember
              ? "Already in the Discord? Come play something."
              : "Stuck on a tool? Real people are a message away."}
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
            {isMember
              ? "You're already part of the crew, so we'll skip the invite. We just launched free fantasy games. Take a break from the tools and see how sharp your instincts really are."
              : "Drop into our Discord for free help from real fantasy players on any tool here, and more tools are on the way. Want to know what shaped these ones and who is behind them? Read about FF Beacon."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {isMember ? (
              <Link
                href="/games"
                className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Gamepad2 aria-hidden="true" className="h-4 w-4" />
                Explore our free games
              </Link>
            ) : (
              <a
                href="/join"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Join our Discord (opens in new tab)"
                className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <DiscordGlyph className="h-4 w-4" />
                Join our Discord
              </a>
            )}
            <Link
              href="/about"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Read about FF Beacon
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
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

/** Discord wordmark glyph, matching the icon used on the homepage, in the
 *  footer, and in the floating Discord CTA. Lucide ships no Discord icon,
 *  so we inline the official brand path. Decorative: the surrounding link
 *  carries the label. */
function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable={false}
    >
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.075.035c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.075-.035 19.74 19.74 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}
