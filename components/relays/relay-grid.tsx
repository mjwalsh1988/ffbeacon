/**
 * Relay cards three across on a wide screen, two on a tablet, one on a phone.
 * The cards are the compact variant, so a headline runs to three lines and
 * the rest is one link away; the list stays a list for a screen reader.
 *
 * Server component.
 */

import type { RelayCardData } from "@/lib/relays/load";
import { RelayCard } from "./relay-card";

export function RelayGrid({
  relays,
  headingLevel = 3,
  labelledBy,
}: {
  relays: RelayCardData[];
  headingLevel?: 2 | 3 | 4;
  labelledBy?: string;
}) {
  return (
    <ul role="list" aria-labelledby={labelledBy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {relays.map((relay) => (
        <li key={relay.id} className="min-w-0">
          <RelayCard relay={relay} headingLevel={headingLevel} variant="compact" />
        </li>
      ))}
    </ul>
  );
}
