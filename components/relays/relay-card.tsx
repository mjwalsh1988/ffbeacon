/**
 * One Relay as a card: the structured headline of one accepted source post.
 *
 * Semantic shape, per docs/beacon-brief/relays-and-briefs-plan.md section 6.2:
 * an <article> labelled by its own heading, a header row of text chips (kind,
 * week, availability, "Update" when it follows an earlier Relay), the facts as
 * a <dl>, player and team pills as real links, and a footer carrying the
 * original-report credit with a real link and the permalink. Nothing visible
 * is aria-hidden; the kind icon is decorative and the chip beside it carries
 * the word. Pills and the Update chip, the only interactive chip, are at least
 * 44 px tall. The availability chip carries no tinted fill: purple on the
 * elevated surface clears AA, purple on a purple wash does not. The <dl> stacks
 * on a phone so every fact stays on screen.
 *
 * Server component. No sentence generation: the headline and facts are the
 * stored row, composed by lib/relays/render.ts.
 */

import Link from "next/link";
import {
  Activity,
  ArrowLeftRight,
  Award,
  FileSignature,
  Gavel,
  Layers,
  Newspaper,
  ShieldAlert,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { formatEastern, formatEasternDate } from "@/lib/datetime";
import { RELAY_KIND_LABELS, type RelayAvailability, type RelayKind } from "@/lib/relays/types";
import type { RelayCardData } from "@/lib/relays/load";

const KIND_ICONS: Record<RelayKind, LucideIcon> = {
  injury: Activity,
  transaction: ArrowLeftRight,
  contract: FileSignature,
  suspension: ShieldAlert,
  depth_chart: Layers,
  coaching: Workflow,
  performance: Award,
  draft: Users,
  legal: Gavel,
  other: Newspaper,
};

const AVAILABILITY_LABELS: Record<RelayAvailability, string> = {
  out: "Out",
  doubtful: "Doubtful",
  questionable: "Questionable",
  active: "Active",
  ir: "Injured reserve",
  pup: "PUP list",
  released: "Released",
  signed: "Signed",
  traded: "Traded",
  suspended: "Suspended",
  waived: "Waived",
  none: "",
};

const chipShape =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em]";
/** The chips that are plain text. 28 px keeps the header row compact. */
const chipBase = `${chipShape} min-h-7`;
/** The Update chip is a link, so it takes the project's 44 px interactive floor. */
const chipLinkBase = `${chipShape} min-h-11`;
const pillBase =
  "inline-flex min-h-11 items-center rounded-full border border-line bg-base px-3 text-xs text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/** How many facts and pills a compact card shows before pointing at the permalink. */
const COMPACT_FACTS = 2;
const COMPACT_PILLS = 2;

export function RelayCard({
  relay,
  headingLevel = 3,
  /** True on the permalink page, where the card is the page and needs no permalink. */
  isPermalinkPage = false,
  variant = "full",
}: {
  relay: RelayCardData;
  /**
   * 1 on the permalink page, where the card headline IS the page title, so the
   * document's first heading is the h1 and the chain's h2s sit under it. 4 on
   * the homepage, where the cards sit under a group heading that is itself an
   * h3 under the section's h2.
   */
  headingLevel?: 1 | 2 | 3 | 4;
  isPermalinkPage?: boolean;
  /**
   * `compact` is the grid card: the headline clamped to three lines, the first
   * two facts, the first two pills, and a counted link to the permalink for
   * the rest. Nothing is dropped silently: what the card does not show, it
   * says it is not showing, and the full card is one link away.
   */
  variant?: "full" | "compact";
}) {
  const Heading = (`h${headingLevel}` as const) as "h1" | "h2" | "h3" | "h4";
  const headingId = `relay-${relay.id}-headline`;
  const Icon = KIND_ICONS[relay.kind];
  const compact = variant === "compact";
  const availability =
    relay.availability && relay.availability !== "none"
      ? AVAILABILITY_LABELS[relay.availability]
      : null;
  const facts = compact ? relay.facts.slice(0, COMPACT_FACTS) : relay.facts;
  const hiddenFacts = relay.facts.length - facts.length;
  const pills = [
    ...relay.players.map((p) => ({ key: `p-${p.slug}`, href: `/players/${p.slug}`, label: p.name, detail: [p.position, p.team].filter(Boolean).join(", ") })),
    ...relay.teams.map((t) => ({ key: `t-${t.abbreviation}`, href: `/brief/team/${t.abbreviation}`, label: t.name, detail: "" })),
  ];
  const shownPills = compact ? pills.slice(0, COMPACT_PILLS) : pills;
  const hiddenPills = pills.length - shownPills.length;

  return (
    <article
      aria-labelledby={headingId}
      className={`flex h-full flex-col rounded-card border border-line bg-surface-elevated shadow-lg shadow-black/20 ${compact ? "p-4" : "p-5"}`}
    >
      <header>
        <p className="flex flex-wrap items-center gap-2">
          <span className={`${chipBase} border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan`}>
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            {RELAY_KIND_LABELS[relay.kind]}
          </span>
          {relay.week !== null && (
            <span className={`${chipBase} border-line text-ink-muted`}>Week {relay.week}</span>
          )}
          {availability && (
            <span className={`${chipBase} border-brand-purple/40 text-brand-purple-light`}>
              {availability}
            </span>
          )}
          {relay.followsSlug && (
            <Link
              href={`/brief/relay/${relay.followsSlug}`}
              className={`${chipLinkBase} border-signal-warning/40 bg-signal-warning/10 text-signal-warning hover:border-signal-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan`}
            >
              Update
              <span className="sr-only">: read the earlier report this one follows</span>
            </Link>
          )}
        </p>
        <Heading
          id={headingId}
          className={`mt-3 font-semibold leading-snug tracking-tight text-ink ${compact ? "text-base" : "text-lg"}`}
        >
          {isPermalinkPage ? (
            relay.headline
          ) : (
            <Link
              href={`/brief/relay/${relay.slug}`}
              className={`hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${compact ? "line-clamp-3" : ""}`}
            >
              {relay.headline}
            </Link>
          )}
        </Heading>
      </header>

      {facts.length > 0 && (
        <dl className={`mt-3 grid gap-x-4 gap-y-1.5 text-sm ${compact ? "" : "sm:grid-cols-[auto_minmax(0,1fr)]"}`}>
          {facts.map((fact, i) => (
            <div key={`${fact.label}-${i}`} className="contents">
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-subtle sm:pt-0.5">
                {fact.label}
              </dt>
              <dd className={`text-ink-muted ${compact ? "line-clamp-2" : ""}`}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {hiddenFacts > 0 && (
        <p className="mt-2 text-xs">
          <Link
            href={`/brief/relay/${relay.slug}`}
            className="inline-flex min-h-11 items-center font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {hiddenFacts} more {hiddenFacts === 1 ? "fact" : "facts"} on the full report
          </Link>
        </p>
      )}

      {shownPills.length > 0 && (
        <p className={`flex flex-wrap items-center gap-2 ${compact ? "mt-3" : "mt-4"}`}>
          {shownPills.map((pill) => (
            <Link key={pill.key} href={pill.href} className={pillBase}>
              {pill.label}
              {pill.detail && <span className="ml-1.5 text-[11px] text-ink-subtle">{pill.detail}</span>}
            </Link>
          ))}
          {hiddenPills > 0 && (
            <Link
              href={`/brief/relay/${relay.slug}`}
              className={`${pillBase} border-dashed`}
            >
              {hiddenPills} more
              <span className="sr-only"> {hiddenPills === 1 ? "player or team" : "players or teams"} on the full report</span>
            </Link>
          )}
        </p>
      )}

      <footer
        className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-ink-subtle"
      >
        <p>
          {compact ? "" : "Original report: "}
          {relay.sourceUrl ? (
            <a
              href={relay.sourceUrl}
              rel="nofollow noopener noreferrer"
              target="_blank"
              className="font-medium text-ink-muted underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              @{relay.sourceHandle.replace(/^@/, "")} on X
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span>@{relay.sourceHandle.replace(/^@/, "")} on X</span>
          )}
          ,{" "}
          <time dateTime={relay.sourcePostedAt}>
            {compact ? formatEasternDate(relay.sourcePostedAt) : formatEastern(relay.sourcePostedAt)}
          </time>
        </p>
        <span className="flex flex-wrap items-center gap-3">
          {relay.brief && (
            <Link
              href={`/brief/${relay.brief.slug}`}
              className="inline-flex min-h-11 items-center font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Covered in the Brief
              <span className="sr-only">: {relay.brief.title}</span>
            </Link>
          )}
          {!isPermalinkPage && !compact && (
            <Link
              href={`/brief/relay/${relay.slug}`}
              className="inline-flex min-h-11 items-center font-semibold text-ink-muted underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Permalink
              <span className="sr-only">: {relay.headline}</span>
            </Link>
          )}
        </span>
      </footer>
    </article>
  );
}
