import type { Metadata } from "next";
import Link from "next/link";
import {
  Accessibility,
  ArrowRight,
  BarChart3,
  BookOpen,
  Calculator,
  Clock,
  Contrast,
  Eye,
  Keyboard,
  Newspaper,
  Radar,
  Scale,
  Smartphone,
  Swords,
  Timer,
  UserCircle,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TOOLS_NAV } from "@/lib/site";
import { AuthorPortrait } from "@/components/author-portrait";
import { ContactPanel } from "@/components/contact-panel";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { LinkTile } from "@/components/link-tile";
import { Panel } from "@/components/dashboard-panel";
import { isDiscordMember } from "@/lib/discord-membership";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead, type MastheadStat } from "@/components/app-shell/page-masthead";

export const metadata: Metadata = {
  alternates: { canonical: "/about" },
  title: "About FF Beacon",
  description:
    "FF Beacon is a free fantasy football site built accessibility-first: rankings, league tools, and news that read the same by ear as by eye.",
};

/**
 * /about
 *
 * The page that says what this site is, who it is for, and where everything on
 * it lives. It is laid out as a dashboard rather than a marketing page: a
 * masthead, panels down the main column, and a rail carrying the contact form
 * and the shortest routes into the product.
 *
 * The counts in the masthead and in "Where the numbers come from" are READ FROM
 * THE DATABASE, not typed here. A number written into a marketing page is
 * correct on the day it ships and quietly wrong from then on, and the honesty of
 * this page is the whole point of it. Each one falls back to omitting the stat
 * rather than showing a guess.
 */

type SiteCounts = {
  formats: number | null;
  sources: number | null;
  sourceNames: string[];
  articles: number | null;
};

async function loadSiteCounts(): Promise<SiteCounts> {
  try {
    const supabase = await createClient();
    const [formatsRes, sourcesRes, articlesRes] = await Promise.all([
      supabase
        .from("format_configs")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      supabase
        .from("source_registry")
        .select("display_name")
        .eq("is_active", true)
        .order("display_name", { ascending: true }),
      supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("status", "published"),
    ]);
    const sourceNames = (sourcesRes.data ?? []).map((row) => row.display_name);
    return {
      formats: formatsRes.count ?? null,
      sources: sourceNames.length > 0 ? sourceNames.length : null,
      sourceNames,
      articles: articlesRes.count ?? null,
    };
  } catch {
    // The page is about the product, not about the database. If a count cannot
    // be read, the stat is left out and every sentence around it still stands.
    return { formats: null, sources: null, sourceNames: [], articles: null };
  }
}

/** "A, B, C, and D", so the source list reads as a sentence. */
function listSentence(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export default async function AboutPage() {
  // Confirmed Discord members already have the community; point the closing CTA
  // at the product instead of the invite.
  const [isMember, counts] = await Promise.all([isDiscordMember(), loadSiteCounts()]);

  const stats: MastheadStat[] = [
    {
      label: "Free tools",
      value: String(TOOLS_NAV.length),
      detail: "No paid tier",
      accent: "cyan",
    },
  ];
  if (counts.formats) {
    stats.push({
      label: "Scoring formats",
      value: String(counts.formats),
      detail: "Redraft to dynasty",
      accent: "purple",
    });
  }
  if (counts.sources) {
    stats.push({
      label: "Value sources",
      value: String(counts.sources),
      detail: "You pick",
      accent: "cyan",
    });
  }
  stats.push({
    label: "Cost",
    value: "$0",
    detail: "All of it",
    accent: "purple",
  });

  return (
    <main id="main">
      <PageBody flush>
        <PageMasthead
          eyebrow="About"
          title="Fantasy football that finally works for everyone."
          description="Rankings, league tools, and news that read the same by ear as by eye. Built by a blind dynasty manager who got tired of stats trapped in charts he could not reach, for anyone who has ever been talked past by a fantasy analyst."
          stats={stats}
        />
      </PageBody>

      <PageColumns
        railLabel="Contact and quick links"
        rail={
          <>
            <ContactPanel pageKey="about" />

            <Panel eyebrow="Start here" title="Three ways in" headingLevel={2}>
              <div className="grid gap-2">
                <LinkTile
                  href="/rankings"
                  icon={BarChart3}
                  title="Rankings board"
                  body="Every player and pick, in your format, with a profile behind each name."
                />
                <LinkTile
                  href="/tools/league-pulse"
                  icon={Workflow}
                  title="League Pulse"
                  body="Type a Sleeper username and read your league in one screen."
                  accent="purple"
                />
                <LinkTile
                  href="/brief"
                  icon={Newspaper}
                  title="The Beacon Brief"
                  body="What broke today, and what it does to your roster."
                />
              </div>
            </Panel>

            <Panel eyebrow="Elsewhere" title="Find us" headingLevel={2}>
              <div className="grid gap-2">
                <LinkTile
                  href="/join"
                  icon={Users}
                  title="The Discord"
                  body="Ask a lineup question and get an answer from a person."
                  accent="purple"
                />
                <LinkTile
                  href="/author/michael"
                  icon={UserCircle}
                  title="Who builds this"
                  body="Michael, twenty seasons in, and why a fantasy site needed building this way."
                />
              </div>
            </Panel>
          </>
        }
      >
        <Panel
          eyebrow="Mission"
          title="Two gaps, closed in one product"
          helper="Most fantasy tools were built by analysts for analysts, then bolted onto an interface that assumes you can see the chart."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <GapCard
              icon={BookOpen}
              accent="purple"
              title="The jargon barrier"
              body="Target share, opportunity score, route participation. These get used as though everyone already knows them. We define the metric in the same view where you use it, and we show the arithmetic instead of asking you to trust it."
            />
            <GapCard
              icon={Accessibility}
              accent="cyan"
              title="The accessibility gap"
              body="Stats trapped in an unlabeled chart. Filters you can only reach with a mouse. Player news that updates silently. Every screen here is written as semantic HTML first, then driven with a keyboard and a screen reader before it ships."
            />
          </div>
        </Panel>

        <Panel
          eyebrow="The product"
          title="What you can do here"
          helper="All of it free, all of it without an account, apart from the parts that save something to one."
        >
          <div className="grid gap-2 lg:grid-cols-2">
            <LinkTile
              href="/rankings"
              icon={BarChart3}
              title="Rankings board"
              body="Values, tiers, positional ranks, and seven-day movement, with a full profile behind every player."
            />
            <LinkTile
              href="/tools/league-pulse"
              icon={Workflow}
              title="Sleeper League Pulse"
              body="Sync a league and read every roster, trade, and waiver move in it. Power Pulse scores what each team should win from here."
              accent="purple"
            />
            <LinkTile
              href="/tools/on-the-clock"
              icon={Timer}
              title="On The Clock"
              body="Connects to your live Sleeper draft and flags who is falling while the clock is still running."
            />
            <LinkTile
              href="/tools/signal-check"
              icon={Scale}
              title="Signal Check"
              body="Grade a trade and get the verdict, the value margin, and how confident the read is."
              accent="purple"
            />
            <LinkTile
              href="/tools/beacon-breakdown"
              icon={Swords}
              title="Beacon Breakdown"
              body="Two players side by side, with the numbers that actually separate them."
            />
            <LinkTile
              href="/tools/faab"
              icon={Calculator}
              title="FAAB Calculator"
              body="A suggested bid range for a waiver pickup, weighed against your budget and your roster."
              accent="purple"
            />
            <LinkTile
              href="/brief"
              icon={Newspaper}
              title="The Beacon Brief"
              body={
                counts.articles
                  ? `NFL news with the fantasy impact spelled out. ${counts.articles.toLocaleString()} stories published so far.`
                  : "NFL news with the fantasy impact spelled out, written in plain English."
              }
            />
            <LinkTile
              href="/guides"
              icon={BookOpen}
              title="Guides"
              body="A glossary of every term that does real work, and a draft guide that rebuilds itself all preseason."
              accent="purple"
            />
            <LinkTile
              href="/games/signal-scout"
              icon={Radar}
              title="Signal Scout"
              body="Decode the profile, name the player. A guessing game built on the same data as the board."
            />
            <LinkTile
              href="/login"
              icon={UserCircle}
              title="A free account"
              body="Save your Sleeper leagues, build a rankings board in your own order, and claim a public Signal profile."
              accent="purple"
            />
          </div>
        </Panel>

        <Panel
          eyebrow="How we build"
          title="Accessibility, in practice"
          helper="The six rules that decide whether something is finished."
        >
          <ul role="list" className="grid gap-2 lg:grid-cols-2">
            <PracticeItem
              icon={Accessibility}
              title="Semantic HTML first"
              body="A button is a button. ARIA is used where HTML cannot express the meaning, not as a substitute for it."
            />
            <PracticeItem
              icon={Keyboard}
              title="Everything works by keyboard"
              body="Every control is reachable and operable without a mouse, and the focus ring is never removed without a replacement."
            />
            <PracticeItem
              icon={Smartphone}
              title="Nothing is dropped on a phone"
              body="When a table will not fit, the row restacks. A column is never hidden at a breakpoint to make the layout easier."
            />
            <PracticeItem
              icon={Eye}
              title="Color never carries meaning alone"
              body="Every colored state is paired with text, so a verdict reads the same to a screen reader as it looks on the page."
            />
            <PracticeItem
              icon={Contrast}
              title="Contrast has a floor"
              body="WCAG AA is the minimum anything ships at, and AAA is the target wherever the type size allows it."
            />
            <PracticeItem
              icon={Clock}
              title="One time zone, always labeled"
              body="Every timestamp on the site is shown in US Eastern with the zone attached, so nothing depends on what your device believes."
            />
          </ul>
        </Panel>

        <Panel
          eyebrow="Data"
          title="Where the numbers come from"
          helper="You pick the source and the format. The rest of the site follows that choice."
        >
          <div className="space-y-4 text-sm leading-relaxed text-ink-muted">
            <p>
              {counts.sourceNames.length > 0 ? (
                <>
                  Player values come from{" "}
                  <span className="font-semibold text-ink">
                    {listSentence(counts.sourceNames)}
                  </span>
                  . Pick the one you trust and every page follows it, including the
                  trade grades and the league power rankings.
                </>
              ) : (
                <>
                  Player values come from several public sources plus FF Beacon&apos;s
                  own. Pick the one you trust and every page follows it, including the
                  trade grades and the league power rankings.
                </>
              )}
            </p>
            <p>
              {counts.formats
                ? `${counts.formats} scoring formats are live, from redraft standard through dynasty superflex with a tight end premium.`
                : "Every scoring format we carry runs from redraft standard through dynasty superflex with a tight end premium."}{" "}
              A source only offers the formats it genuinely publishes, so you are
              never shown a number that was copied sideways from a format it was not
              built for.
            </p>
            <p>
              Values rebuild nightly and the trend windows recalculate with them, so a
              seven-day move covers seven real days. Projections are Sleeper&apos;s
              weekly numbers rescored under each format&apos;s own rules rather than
              read off a generic column, which is why a tight end premium actually
              counts.
            </p>
            <p>
              Inside a synced league, values use{" "}
              <span className="font-semibold text-ink">that league&apos;s</span> scoring
              settings rather than whatever you have picked globally. A trade is graded
              in the league it happened in, because that is the only format it ever
              meant anything in.
            </p>
          </div>
        </Panel>

        <Panel eyebrow="Founder" title="Who builds it">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6">
            <Link
              href="/author/michael"
              aria-label="Read Michael's full story on the author page"
              className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan"
            >
              <span
                aria-hidden="true"
                className="block rounded-full p-[2px]"
                style={{
                  backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
                }}
              >
                <span className="block rounded-full bg-surface p-1">
                  <AuthorPortrait size={112} />
                </span>
              </span>
            </Link>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                Michael, founder of FF Beacon
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink">
                Twenty seasons in fantasy, played stats-first across redraft, dynasty,
                superflex, and tight end premium. Partly because that is how you win,
                and partly because most fantasy interfaces are not built for a blind
                dynasty manager. FF Beacon is what happened when reading the game by
                the numbers stopped being a workaround and became the product.
              </p>
              <Link
                href="/author/michael"
                className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Read the full story
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Panel>
      </PageColumns>

      <DiscordCtaSection
        eyebrow="See it in action"
        heading="Come see the mission in practice."
        body="The best way to understand FF Beacon is to use it. Drop into our Discord and real fantasy players will show you around, free, or jump straight into the tools built on everything above."
        className="border-t border-line"
        secondaryHref="/tools"
        secondaryLabel="See every free tool"
        isMember={isMember}
        memberHeading="You get the mission. Now go use it."
        memberBody="You're already part of the crew, so we'll skip the invite. The best way to feel the difference is to use it, so dive into the rankings and the rest of the free toolkit."
        memberCtaHref="/rankings"
        memberCtaLabel="Open the rankings"
      />
    </main>
  );
}

/* ---------- Pieces ---------- */

/** One of the two gaps the site exists to close. */
function GapCard({
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
    <article
      className="relative overflow-hidden rounded-card border border-line bg-base/50 p-4 sm:p-5"
      style={{ boxShadow: `0 0 64px -46px ${color}99` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-px"
        style={{
          backgroundImage: `linear-gradient(180deg, transparent 0%, ${color} 30%, ${color}66 70%, transparent 100%)`,
        }}
      />
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-card border"
        style={{
          backgroundImage: `linear-gradient(135deg, ${color}26 0%, ${color}0D 100%)`,
          borderColor: `${color}59`,
          color,
        }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-3 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
    </article>
  );
}

/** One rule from the accessibility list. */
function PracticeItem({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-card border border-line bg-base/40 p-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{body}</span>
      </span>
    </li>
  );
}
