import type { Metadata } from "next";
import Link from "next/link";
import { HeartHandshake, Server, ShieldCheck, Wrench } from "lucide-react";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { Panel } from "@/components/dashboard-panel";
import { DonateForm } from "@/components/donate/donate-form";
import { PAY_HANDLE_DISPLAY } from "@/lib/donate/links";
import { stripeConfigured } from "@/lib/donate/stripe";
import { pageShareMetadata } from "@/lib/page-og";

export const metadata: Metadata = {
  alternates: { canonical: "/donate" },
  title: "Donate to FF Beacon",
  description:
    "FF Beacon is paid for by one person and given away to everyone. If it has been useful, you can put something back.",
  ...pageShareMetadata({
    key: "donate",
    title: "Donate to FF Beacon",
    description:
      "FF Beacon is paid for by one person and given away to everyone. If it has been useful, you can put something back.",
    path: "/donate",
  }),
};

/**
 * /donate
 *
 * The header modal's page-shaped twin, and the home of the URL people will type
 * or paste. It renders the same `DonateForm`, so the amounts, the wording and
 * the three payment routes are the same here as in the panel.
 *
 * It also exists because /donate/thanks has to live somewhere, and a parent path
 * that 404s under a working child is a broken site by any reading.
 */
export default function DonatePage() {
  return (
    <main id="main">
      <PageBody width="reading">
        <PageMasthead
          eyebrow="Support"
          title="This is paid for by one person."
          description="FF Beacon has no subscription, no paywall and no locked tier. It runs on a personal card, and it stays free either way. A donation just means it costs that card less."
        />

        <div className="mt-8 grid gap-6">
          <Panel
            eyebrow="Give"
            title="Make a donation"
            helper="Card, Apple Pay, Google Pay, PayPal or Venmo. Pick an amount and go."
            glow
          >
            <DonateForm surface="donate_page" cardEnabled={stripeConfigured()} />
          </Panel>

          <Panel
            eyebrow="Where it goes"
            title="What a donation actually pays for"
            helper="Small, dull and monthly. That is most of what running this costs."
          >
            <ul role="list" className="grid gap-2 sm:grid-cols-2">
              <CostItem
                icon={Server}
                title="Hosting and the database"
                body="Every page, every league sync, and the store behind them. This is the bill that grows when more people show up."
              />
              <CostItem
                icon={Wrench}
                title="Data feeds and the model"
                body="Player values, projections, odds, news, and the machine time that turns them into the numbers on the board."
              />
              <CostItem
                icon={ShieldCheck}
                title="The domain and the mail"
                body="Renewals, the sending domain behind the Beacon Brief, and the boring infrastructure nobody notices until it stops."
              />
              <CostItem
                icon={HeartHandshake}
                title="The time to keep it accessible"
                body="Every screen is driven with a keyboard and a screen reader before it ships. That is the slow part, and it is the point."
              />
            </ul>
          </Panel>

          <Panel eyebrow="The fine print" title="What giving does and does not do">
            <div className="space-y-3 text-sm leading-relaxed text-ink-muted">
              <p>
                A donation is a gift to the person who builds FF Beacon. It is not a
                purchase, it buys no feature, and it unlocks nothing, because there is
                nothing locked. Donors get no ranking boost, no private data and no
                say in a player&apos;s value.
              </p>
              <p>
                Because it is a gift rather than a sale, a donation is final and is not
                refunded. If something has clearly gone wrong, a duplicate charge or an
                amount that is not what you meant to send, get in touch and we will try
                to put it right. The full wording lives in the{" "}
                <Link
                  href="/terms"
                  className="text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Terms of Service
                </Link>
                .
              </p>
              <p>
                FF Beacon is not a registered charity and a donation is not tax
                deductible. Card payments are handled by Stripe on their own secure
                page; PayPal and Venmo both go to {PAY_HANDLE_DISPLAY}. We never see or
                store a card number. What each processor collects is set out in the{" "}
                <Link
                  href="/privacy"
                  className="text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Privacy Policy
                </Link>
                .
              </p>
              <p>
                Not in a position to give? That is genuinely fine, and nothing about the
                site changes. Telling one person the tools exist helps just as much.
              </p>
            </div>
          </Panel>
        </div>
      </PageBody>
    </main>
  );
}

/** One line item in the running-costs list. */
function CostItem({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Server;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-card border border-line bg-base/40 p-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{body}</span>
      </span>
    </li>
  );
}
