/**
 * Says a review is already under way for this team, and never stops the reader
 * ordering another: a second read after a run of moves is a real reason to buy one.
 * A status, not an alert, and cyan rather than a warning color.
 */

import Link from "next/link";
import type { Route } from "next";
import { formatEasternShortDate } from "@/lib/datetime";
import type { ReviewInProgress } from "@/lib/commerce/orders";

export function ReviewInProgressNotice({ review }: { review: ReviewInProgress | null }) {
  return (
    <div role="status">
      {review && (
        <p className="border-t border-brand-cyan/40 bg-brand-cyan/10 px-5 py-4 text-sm leading-relaxed text-ink sm:px-8">
          You already have a {review.productName} in progress for {review.teamName} ({review.orderNumber}
          {review.dueAt ? `, due by ${formatEasternShortDate(review.dueAt)}` : ""}). You can still order another
          one, for example after a run of moves.{" "}
          <Link
            href={`/my-beacon/orders/${review.orderId}` as Route}
            className="inline-flex min-h-11 items-center font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Open that order
          </Link>
        </p>
      )}
    </div>
  );
}
