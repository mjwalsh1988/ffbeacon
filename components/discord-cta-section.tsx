import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { DiscordGlyph } from "@/components/discord-glyph";

/** Shared bottom-of-page CTA: join the Discord for free help, or read about
 *  FF Beacon. Visual style matches the tools index page CTA. Every page that
 *  renders this should pass its own eyebrow/heading/body so the copy isn't
 *  duplicated verbatim across routes. The secondary button defaults to
 *  "Read about FF Beacon" -> /about; override it on pages (like /about
 *  itself) where that link would point back at the current page. */
export function DiscordCtaSection({
  eyebrow,
  heading,
  body,
  headingId = "discord-cta-heading",
  className = "",
  secondaryHref = "/about",
  secondaryLabel = "Read about FF Beacon",
}: {
  eyebrow: string;
  heading: string;
  body: string;
  headingId?: string;
  className?: string;
  secondaryHref?: Route;
  secondaryLabel?: string;
}) {
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
            {eyebrow}
          </p>
          <h2
            id={headingId}
            className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            {heading}
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
            {body}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
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
