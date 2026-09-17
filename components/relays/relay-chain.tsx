/**
 * The chain of earlier and later Relays for one story, on the permalink page.
 * Two labelled lists of cards, each omitted when empty, so a reader moving by
 * heading meets "Earlier reports" and "Later reports" only when there are any.
 *
 * Server component.
 */

import { RelayCard } from "./relay-card";
import type { RelayCardData } from "@/lib/relays/load";

export function RelayChain({ earlier, later }: { earlier: RelayCardData[]; later: RelayCardData[] }) {
  if (earlier.length === 0 && later.length === 0) return null;
  return (
    <>
      {earlier.length > 0 && (
        <section aria-labelledby="relay-earlier-heading" className="mt-10">
          <h2 id="relay-earlier-heading" className="mb-4 text-lg font-semibold tracking-tight text-ink">
            Earlier reports on this story
          </h2>
          <ul role="list" className="space-y-4">
            {earlier.map((r) => (
              <li key={r.id}>
                <RelayCard relay={r} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {later.length > 0 && (
        <section aria-labelledby="relay-later-heading" className="mt-10">
          <h2 id="relay-later-heading" className="mb-4 text-lg font-semibold tracking-tight text-ink">
            Later reports on this story
          </h2>
          <ul role="list" className="space-y-4">
            {later.map((r) => (
              <li key={r.id}>
                <RelayCard relay={r} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
