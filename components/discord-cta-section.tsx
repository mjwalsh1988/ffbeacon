import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, LayoutGrid, Gamepad2 } from "lucide-react";
import { DiscordGlyph } from "@/components/discord-glyph";

/** Shared bottom-of-page CTA.
 *
 *  Default (non-member) mode nudges visitors into the FF Beacon Discord for
 *  free help, with a secondary "read about FF Beacon" link.
 *
 *  When `isMember` is true (the signed-in user is already in our Discord, as
 *  resolved server-side by the page), the Discord invite is wasted real estate.
 *  We swap the whole section over to member-focused copy plus an internal
 *  primary action (defaults to "Explore our fantasy tools" -> /tools). The
 *  member copy is passed per page so the tone stays specific and on brand; if a
 *  page opts into member mode without overriding the copy, sensible generic
 *  defaults are used. The secondary link carries through unchanged.
 *
 *  Visual style is always FF Beacon brand. Every page that renders this passes
 *  its own eyebrow/heading/body so the copy is not duplicated verbatim. */
type MemberCtaIcon = "tools" | "games";

const MEMBER_ICONS: Record<MemberCtaIcon, typeof ArrowRight> = {
  tools: LayoutGrid,
  games: Gamepad2,
};

export function DiscordCtaSection({
  eyebrow,
  heading,
  body,
  headingId = "discord-cta-heading",
  className = "",
  secondaryHref = "/about",
  secondaryLabel = "Read about FF Beacon",
  isMember = false,
  memberEyebrow = "Already in the Discord",
  memberHeading = "You're already in the crew. Put the tools to work.",
  memberBody = "Thanks for being part of the Discord, so we'll skip the invite. Explore the rest of the free FF Beacon toolkit whenever you need a hand with your team.",
  memberCtaHref = "/tools" as Route,
  memberCtaLabel = "Explore our fantasy tools",
  memberCtaIcon = "tools",
}: {
  eyebrow: string;
  heading: string;
  body: string;
  headingId?: string;
  className?: string;
  secondaryHref?: Route;
  secondaryLabel?: string;
  /** True when the current user is a confirmed Discord guild member. */
  isMember?: boolean;
  memberEyebrow?: string;
  memberHeading?: string;
  memberBody?: string;
  memberCtaHref?: Route;
  memberCtaLabel?: string;
  memberCtaIcon?: MemberCtaIcon;
}) {
  const MemberIcon = MEMBER_ICONS[memberCtaIcon];
  return (
    <section aria-labelledby={headingId} className={className}>
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-line bg-surface p-8 sm:p-10"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            {isMember ? memberEyebrow : eyebrow}
          </p>
          <h2
            id={headingId}
            className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            {isMember ? memberHeading : heading}
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
            {isMember ? memberBody : body}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {isMember ? (
              <Link
                href={memberCtaHref}
                className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <MemberIcon aria-hidden="true" className="h-4 w-4" />
                {memberCtaLabel}
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
              href={secondaryHref}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {secondaryLabel}
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
