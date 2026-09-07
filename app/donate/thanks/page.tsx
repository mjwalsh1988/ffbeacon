import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Info } from "lucide-react";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { Panel } from "@/components/dashboard-panel";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { formatUsd } from "@/lib/donate/amounts";
import { isCheckoutSessionId, retrieveCheckoutSession } from "@/lib/donate/stripe";
import { donationOutcome, type DonationOutcome } from "@/lib/donate/outcome";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Thank you",
  description: "Your donation to FF Beacon.",
  // A receipt is nobody's landing page and has no business in an index.
  robots: { index: false, follow: false },
};

// The page asks Stripe about one specific session on every view. Nothing here
// can be cached: a receipt served from a cache is somebody else's receipt.
export const dynamic = "force-dynamic";

/** Where a donor goes when something about their payment looks wrong. */
const CONTACT = SITE.legalContactEmail;

/**
 * /donate/thanks
 *
 * Where Stripe returns a reader after Checkout. The session id it appends is the
 * only thing the browser carries out, and this page does NOT take the browser's
 * word for what happened: it asks Stripe directly and reports what Stripe says.
 * A page that congratulated a reader on a donation because a query string said
 * so would congratulate anyone who typed one.
 *
 * Only two facts are read out of the session, the status and the total. Nothing
 * about the person, nothing about the card. Anything with their details on it
 * stays on Stripe, which is the right place for it.
 *
 * Three honest outcomes, and no fourth:
 *   paid       the money arrived, say thank you and say how much
 *   pending    some methods settle after the redirect; say that plainly
 *   unknown    we could not confirm it; do not claim either way
 */
export default async function DonateThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;

  let outcome: DonationOutcome = "unknown";
  let amountLabel: string | null = null;

  if (isCheckoutSessionId(sessionId)) {
    // METERED, because this is an unauthenticated GET that makes an outbound
    // Stripe call on every render. The id shape is trivial to generate, so a
    // loop over this URL would otherwise be an unmetered amplifier into the
    // same Stripe read quota that real donors' confirmations depend on, while
    // holding a serverless invocation open for up to ten seconds each time.
    // lib/rate-limit-claim.ts was written for exactly this: a page that decodes
    // work out of its own URL is an entry point too, and a cheaper one to
    // attack than the POST.
    //
    // The limit is deliberately loose. Reloading a receipt is a reasonable
    // thing to do, and the cost of refusing a real donor is that they are told
    // we cannot confirm their donation, which is the worst sentence on the
    // page. A refusal lands on "unknown", which still tells the reader their
    // payment went through rather than casting doubt on it.
    const allowed = await claimRateLimitSlot({
      bucket: "donate-thanks",
      max: 20,
      windowSeconds: 60,
    });

    if (allowed) {
      const result = await retrieveCheckoutSession(sessionId);
      if (result.ok) {
        // The mapping lives in lib/donate/outcome.ts and is tested there. It was
        // inline here, and inline is how it came to read Stripe's `open` status
        // as "pending" and tell an abandoned checkout that their money was on
        // its way.
        outcome = donationOutcome(result.data);
        if (typeof result.data.amount_total === "number") {
          amountLabel = formatUsd(result.data.amount_total);
        }
      }
    }
  }

  const title =
    outcome === "paid"
      ? "Thank you. Genuinely."
      : outcome === "pending"
        ? "Almost there."
        : "Thanks for stopping by.";

  // THE RECEIPT IS OURS NOW, so this page can promise one again. It is sent from
  // /api/donate/webhook when Stripe confirms the payment, which means it does not
  // depend on the reader still having this page open. The wording stays "on its
  // way" rather than "sent": the webhook usually lands within seconds, but this
  // page is rendered by the redirect and the two are not ordered.
  const description =
    outcome === "paid"
      ? amountLabel
        ? `Your ${amountLabel} donation came through, and a receipt is on its way to your inbox.`
        : "Your donation came through, and a receipt is on its way to your inbox."
      : outcome === "pending"
        ? "Your payment has not finished settling yet. Some methods take a few minutes to clear, and your receipt follows the moment it does."
        : "We could not confirm a donation for this link. If you completed one, it still went through.";

  const Icon = outcome === "paid" ? CheckCircle2 : outcome === "pending" ? Clock : Info;
  const accent = outcome === "paid" ? "#22D3EE" : "#A855F7";

  return (
    <main id="main">
      <PageBody width="reading">
        <PageMasthead eyebrow="Donation" title={title} description={description} />

        <div className="mt-8 grid gap-6">
          <Panel
            eyebrow={outcome === "paid" ? "Received" : "Status"}
            title={
              outcome === "paid"
                ? amountLabel
                  ? `${amountLabel}, received`
                  : "Donation received"
                : outcome === "pending"
                  ? "Payment still settling"
                  : "Nothing to confirm here"
            }
            glow={outcome === "paid"}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border"
                style={{
                  borderColor: `${accent}59`,
                  backgroundImage: `linear-gradient(135deg, ${accent}26 0%, ${accent}0D 100%)`,
                  color: accent,
                }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 space-y-3 text-sm leading-relaxed text-ink-muted">
                {outcome === "paid" && (
                  <>
                    <p>
                      That goes straight against the hosting, the data feeds and the
                      domain. It does not buy a feature, because there is no feature to
                      buy: everything on FF Beacon was already free and stays that way.
                    </p>
                    <p>
                      Your receipt is emailed to the address you gave Stripe, usually
                      within a minute. If it has not arrived, check the spam folder
                      first, then email {CONTACT} and I will send it again.
                    </p>
                    <p>
                      Donations are a gift rather than a purchase, so they are final and
                      are not refunded. If something looks wrong, a duplicate charge or
                      an amount you did not mean to send, get in touch and we will sort
                      it out.
                    </p>
                  </>
                )}
                {outcome === "pending" && (
                  <p>
                    Nothing more is needed from you, and there is no reason to pay
                    again in the meantime. The receipt is sent once it clears. If that
                    has not happened in a few hours, email {CONTACT} and I will look it
                    up.
                  </p>
                )}
                {outcome === "unknown" && (
                  <p>
                    This page confirms a donation by asking Stripe about it, and there
                    is no session in this link to ask about. If you came here by hand,
                    the{" "}
                    <Link
                      href="/donate"
                      className="text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      donation page
                    </Link>{" "}
                    is where to start one.
                  </p>
                )}
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Back to it" title="Go and use it">
            <div className="grid gap-2 sm:grid-cols-2">
              <ThanksLink href="/rankings" label="Open the rankings board" />
              <ThanksLink href="/tools/league-pulse" label="Sync a Sleeper league" />
              <ThanksLink href="/brief" label="Read the Beacon Brief" />
              <ThanksLink href="/join" label="Join the Discord" />
            </div>
          </Panel>
        </div>
      </PageBody>
    </main>
  );
}

function ThanksLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-12 items-center justify-between gap-2 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      {label}
      <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
    </Link>
  );
}
