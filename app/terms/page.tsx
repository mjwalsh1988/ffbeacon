import type { Metadata } from "next";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/terms" },
  title: "Terms of Service",
  description:
    "The rules and expectations for using FF Beacon: what you can do, what we expect, and how the service is provided.",
};

const EFFECTIVE_DATE = "May 18, 2026";

export default function TermsPage() {
  return (
    <main id="main">
      <PageBody width="reading">
        <PageMasthead
          eyebrow="Legal"
          title="Terms of Service"
          description={`Effective ${EFFECTIVE_DATE}`}
        />
        <article className="mt-8 space-y-8 text-ink-muted">
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of{" "}
            {SITE.name} (&quot;the Service&quot;), operated by {SITE.author.name}.
            By accessing the Service you agree to these Terms. If you don&apos;t agree,
            please do not use the Service.
          </p>

          <section aria-labelledby="eligibility">
            <h2 id="eligibility" className="text-2xl font-semibold tracking-tight text-ink">
              1. Eligibility
            </h2>
            <p className="mt-3">
              You must be at least 13 years old to use the Service. By creating an
              account you confirm that you meet this age requirement and that the
              information you provide is accurate.
            </p>
          </section>

          <section aria-labelledby="accounts">
            <h2 id="accounts" className="text-2xl font-semibold tracking-tight text-ink">
              2. Accounts and authentication
            </h2>
            <p className="mt-3">
              Account creation is optional. When you choose to sign in, you may
              authenticate through third-party providers (currently Google and
              Discord) or via an email link. We rely on those providers&apos; own
              terms and security; their handling of your credentials is governed
              by their respective terms and privacy policies.
            </p>
            <p className="mt-3">
              You are responsible for keeping your authentication method (your
              email inbox, your Google account, your Discord account) secure. You
              agree to notify us immediately at the contact channels listed on the
              Author page if you believe your account has been compromised.
            </p>
          </section>

          <section aria-labelledby="acceptable-use">
            <h2 id="acceptable-use" className="text-2xl font-semibold tracking-tight text-ink">
              3. Acceptable use
            </h2>
            <p className="mt-3">You agree not to:</p>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                Scrape, crawl, or otherwise harvest data from the Service in a way
                that interferes with other users or imposes a load disproportionate
                to a typical interactive session.
              </li>
              <li>
                Attempt to access accounts, leagues, or data that don&apos;t belong
                to you, including through credential stuffing, session hijacking,
                or social engineering.
              </li>
              <li>
                Submit content (Sleeper usernames, team names, league names) that
                is unlawful, abusive, harassing, or that infringes the rights of
                others.
              </li>
              <li>
                Use the Service to build a competing product without our prior
                written permission.
              </li>
              <li>
                Circumvent rate limits or abuse the admin / commissioner
                force-refresh endpoint described in our documentation.
              </li>
            </ul>
          </section>

          <section aria-labelledby="content">
            <h2 id="content" className="text-2xl font-semibold tracking-tight text-ink">
              4. Your content and third-party data
            </h2>
            <p className="mt-3">
              The Service surfaces public information from third-party providers
              including the Sleeper API, KeepTradeCut, FantasyCalc, and the
              sleepercdn player image CDN. We do not own that data and make no
              warranty as to its accuracy. League rosters, transactions, and
              draft data we display are pulled from Sleeper&apos;s public
              endpoints; if a league is public on Sleeper, its data is visible
              here as well.
            </p>
            <p className="mt-3">
              By linking a Sleeper username to your account you authorize the
              Service to fetch and persist your public Sleeper league data so
              that league sync, power-rankings, and trade-analyzer features can
              operate. You can disconnect this at any time by clearing your
              Sleeper username on the dashboard.
            </p>
          </section>

          <section aria-labelledby="availability">
            <h2 id="availability" className="text-2xl font-semibold tracking-tight text-ink">
              5. Availability and changes
            </h2>
            <p className="mt-3">
              The Service is provided on an as-is, best-effort basis. We may add,
              change, suspend, or remove features at any time, including data
              sources, rankings, or League Pulse coverage. We are not liable for
              downtime, data loss, or content that becomes unavailable because a
              third-party provider changed their API.
            </p>
          </section>

          <section aria-labelledby="ip">
            <h2 id="ip" className="text-2xl font-semibold tracking-tight text-ink">
              6. Intellectual property
            </h2>
            <p className="mt-3">
              The Service&apos;s name, logo, content, design, and code are owned
              by {SITE.author.name}. You may not reproduce or redistribute them
              without permission. Player names, team logos, NFL marks, and Sleeper
              avatars remain the property of their respective owners.
            </p>
          </section>

          <section aria-labelledby="termination">
            <h2 id="termination" className="text-2xl font-semibold tracking-tight text-ink">
              7. Termination
            </h2>
            <p className="mt-3">
              We may suspend or terminate your access to the Service if you
              violate these Terms. You may stop using the Service and delete your
              account at any time; deletion removes your user preferences and
              voting history. Synced public Sleeper league data persists for
              other users of the same league.
            </p>
          </section>

          <section aria-labelledby="warranty">
            <h2 id="warranty" className="text-2xl font-semibold tracking-tight text-ink">
              8. No warranty; limitation of liability
            </h2>
            <p className="mt-3">
              The Service is provided &quot;as is&quot; without warranties of
              any kind, express or implied. To the maximum extent permitted by
              law, {SITE.author.name} is not liable for any indirect, incidental,
              consequential, or punitive damages arising from your use of the
              Service, including (without limitation) lost fantasy matchups,
              failed waiver bids, or trade outcomes. The Service offers analysis,
              not advice; you are responsible for your own roster decisions.
            </p>
          </section>

          <section aria-labelledby="changes">
            <h2 id="changes" className="text-2xl font-semibold tracking-tight text-ink">
              9. Changes to these Terms
            </h2>
            <p className="mt-3">
              We may update these Terms from time to time. When we do, we&apos;ll
              update the &quot;Effective&quot; date at the top of this page.
              Material changes will be highlighted on the homepage or via an
              in-app notice. Continued use after a change constitutes acceptance.
            </p>
          </section>

          <section aria-labelledby="contact">
            <h2 id="contact" className="text-2xl font-semibold tracking-tight text-ink">
              10. Contact
            </h2>
            <p className="mt-3">
              Questions about these Terms? Reach out through the contact channels
              on the Author page.
            </p>
          </section>
        </article>
      </PageBody>
    </main>
  );
}
