/**
 * "These values stopped moving when the season did."
 *
 * The trade-value rankings are the one thing in League Pulse priced off a
 * market that keeps moving after a league stops playing. Once the season is
 * complete the rankings stop being recomputed (see powerRankingsAreStale in
 * lib/league-pulse.ts), so what a reader sees in July is what the league
 * finished on, and this line is what tells them that rather than leaving them
 * to wonder why a champion's roster looks different now.
 *
 * The date is the real one: the `generated_at` of the stored rows, in the
 * site's timezone like every other timestamp on the site.
 *
 * Server component. A `role` is deliberately absent: this is standing
 * explanatory text, not something that changed, and announcing it as a status
 * would interrupt a reader every time the panel re-renders.
 */

import { formatEasternDate } from "@/lib/datetime";

export function FrozenValuesNote({
  generatedAt,
  className = "",
}: {
  /** The `generated_at` of the frozen rows, ISO. Null skips the date. */
  generatedAt: string | null;
  className?: string;
}) {
  return (
    <p
      className={`rounded-card border border-dashed border-line bg-base/40 px-3 py-2.5 text-xs leading-relaxed text-ink-muted ${className}`}
    >
      <span className="font-medium text-ink">This season is finished.</span>{" "}
      Player values kept moving after it ended, so these are frozen at what they
      were worth when the league stopped playing
      {generatedAt ? `, on ${formatEasternDate(generatedAt)}` : ""}, rather than
      revalued against a market this league never played in.
    </p>
  );
}
