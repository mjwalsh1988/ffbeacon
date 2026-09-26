import { parseWeekSegment, weekPath } from "@/lib/waiver-wire/weeks";
import { renderHeadlineCard } from "@/lib/og/headline-card";

export const runtime = "nodejs";

/**
 * GET /api/og/waiver-wire/[week]
 *
 * The share card for one week's waiver wire board, naming the week. Every
 * week used to share the section card, so "week 3 waiver wire" and "week 9
 * waiver wire" previewed identically in a group chat.
 *
 * The week is parsed by the same validator the page uses, so only a real NFL
 * week is ever drawn; anything else gets the section card. Static per week,
 * so it caches hard.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ week: string }> }) {
  const week = parseWeekSegment((await params).week);
  if (week === null) {
    return renderHeadlineCard({
      eyebrow: "Fantasy football waiver wire",
      headlineTop: "Who to add,",
      headlineBottom: "and what to bid",
      subhead:
        "Every week: who is actually still free, whose role just changed, and a bid range from the same engine our FAAB calculator runs.",
      facts: ["Free", "No signup", "Measured, not guessed"],
      footerLeft: "ffbeacon.com/waiver-wire",
      badge: "Waiver Wire",
    });
  }
  return renderHeadlineCard({
    eyebrow: "Fantasy football waiver wire",
    headlineTop: `Week ${week} waiver wire:`,
    headlineBottom: "who to add, what to bid",
    subhead:
      "Who is actually still free, whose role just changed, and a bid range for each from the same engine our FAAB calculator runs.",
    facts: ["Free", "No signup", "Every position"],
    footerLeft: `ffbeacon.com${weekPath(week)}`,
    badge: `Week ${week}`,
  });
}
