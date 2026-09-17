/**
 * relay_quote: one Relay card inline, for the story a paragraph is about.
 * The card is the same RelayCard the feed renders, so the credit line, the
 * facts and the permalink are identical everywhere. The caption is a plain
 * paragraph rather than a heading: the card already carries its own h3.
 *
 * Server component.
 */

import { RelayCard } from "@/components/relays/relay-card";
import type { RelayCardData } from "@/lib/relays/load";

export function RelayQuoteBlock({
  id,
  caption,
  conclusion,
  relay,
}: {
  id: string;
  caption: string;
  conclusion: string;
  relay: RelayCardData | null;
}) {
  return (
    <div className="my-6" id={`block-${id}`}>
      {caption && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{caption}</p>}
      {relay ? (
        <RelayCard relay={relay} headingLevel={3} />
      ) : (
        <p className="rounded-card border border-dashed border-line px-4 py-4 text-sm text-ink-muted">
          The report this passage refers to is no longer published.
        </p>
      )}
      {conclusion && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{conclusion}</p>}
    </div>
  );
}
