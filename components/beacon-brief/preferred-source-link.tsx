import { SITE } from "@/lib/site";
import { preferredSourceHref } from "@/lib/preferred-source";

/**
 * "Add FF Beacon as a preferred source on Google", on Beacon Brief pages.
 *
 * A plain link to Google's documented deeplink (see lib/preferred-source.ts for why
 * it is not Google's script button). It opens in the same tab: a new tab would need
 * announcing, and Google's page has its own way back.
 *
 * The visible link text is the whole accessible name, so no aria-label repeats or
 * contradicts it. The sentence under it is ordinary text in reading order, and says
 * what the choice does rather than asking the reader to take it on trust. The link is
 * at least 44px tall, the site's tap target floor.
 */
export function PreferredSourceLink({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <a
        href={preferredSourceHref()}
        className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Add {SITE.name} as a preferred source on Google
      </a>
      <p className="mt-2 text-sm text-ink-muted">
        Google shows you more from the sites you pick, in Top Stories and in its AI
        answers.
      </p>
    </div>
  );
}
