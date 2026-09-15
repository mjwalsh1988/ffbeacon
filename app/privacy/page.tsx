import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/privacy" },
  title: "Privacy Policy",
  description:
    "What FF Beacon collects, why, who we share it with, what happens when you donate, and how to delete it.",
};

const EFFECTIVE_DATE = "September 14, 2026";
const EFFECTIVE_DATE_ISO = "2026-09-14";
const OPERATOR = SITE.author.legalName;
const CONTACT = SITE.legalContactEmail;

/**
 * /privacy
 *
 * The rule this page is written to: it describes what the code actually does,
 * and nothing else. Every processor listed here is one this repository really
 * calls, every field named is one that is really stored, and where a thing that
 * looks like it should be happening is not happening (a language model reading
 * your questions) the page says so explicitly rather than staying quiet and
 * letting a reader assume the worse answer.
 *
 * That is also why it is specific about the boring parts. "We use analytics" is
 * true of a site that fingerprints every visitor and of one that counts page
 * views without a cookie, and only one of those is what happens here.
 *
 * ADVERTISING (2026-09-14). The site is applying to Google AdSense, and AdSense
 * requires the privacy policy to carry a specific disclosure about third-party
 * advertising cookies and where to opt out of personalized ads
 * (https://support.google.com/adsense/answer/1348695). The "Advertising" block in
 * section 1 is that disclosure, worded to Google's requirement and to the truth:
 * ads are served by Google when they are on, and the page says what that
 * involves before the first one renders. The earlier "we do not use advertising
 * cookies" line was removed at the same time because it stopped being true the
 * moment the application went in.
 */

const LINK_CLASS =
  "text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/** An external link that says so to a screen reader. */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
export default function PrivacyPage() {
  return (
    <main id="main">
      <PageBody width="reading">
        <PageMasthead
          eyebrow="Legal"
          title="Privacy Policy"
          description={
            <>
              Effective <time dateTime={EFFECTIVE_DATE_ISO}>{EFFECTIVE_DATE}</time>
            </>
          }
        />
        <article className="mt-8 space-y-8 text-ink-muted">
          <p>
            This Privacy Policy describes what information {SITE.name}, operated by{" "}
            {OPERATOR} (&quot;we&quot;, &quot;us&quot;), collects when you visit the
            site, why we collect it, who we share it with, and the choices you have. We
            collect the minimum needed to make the product work.
          </p>
          <p>
            The short version: most of {SITE.name} works without an account and without
            you telling us anything. We do not sell your data and we never see your card
            number. Any ad you see on the site is served by Google, and the{" "}
            <a href="#advertising" className={LINK_CLASS}>
              Advertising
            </a>{" "}
            section below says exactly what that involves and how to switch
            personalized ads off. Questions or requests go to {CONTACT}.
          </p>

          <section aria-labelledby="what">
            <h2 id="what" className="text-2xl font-semibold tracking-tight text-ink">
              1. Information we collect
            </h2>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Account information
            </h3>
            <p className="mt-2">
              When you sign in we receive a unique identifier and email address from the
              authentication provider you choose (currently Google or Discord; an
              email-link option may also be available). We do not receive or store your
              password.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Profile information
            </h3>
            <p className="mt-2">
              With your consent we may receive your display name and avatar from the
              OAuth provider. From Google: name, email, profile picture (scopes{" "}
              <code>openid email profile</code>). From Discord: username, avatar, and
              the email associated with your Discord account (scopes{" "}
              <code>identify email</code>). We do not access your Google Drive, Gmail,
              calendar, contacts, or any Discord server or message content.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Preferences and product data
            </h3>
            <p className="mt-2">
              We store the choices you make inside the product: your default fantasy
              format, default data source, theme, optional Sleeper username (for league
              sync), favorite players, custom rankings order, vote history on matchups
              and in the games, and email digest opt-in.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Content you post
            </h3>
            <p className="mt-2">
              If you claim a Signal profile we store its handle, display name, avatar,
              and anything you post to it, including uploaded images (held in Supabase
              Storage). A Signal profile is public: its contents can be read by anyone
              and indexed by search engines. We also store questions you send through
              the guide and contact forms, along with any name or email address you
              choose to include with them.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Sleeper league data
            </h3>
            <p className="mt-2">
              When you enter a Sleeper username, we pull and cache the public data
              Sleeper exposes for those leagues: league metadata, rosters, matchups,
              transactions, drafts, traded picks, and the display names of users within
              those leagues. This data is already public on Sleeper and remains visible
              to other members of the same league inside our product. Note that entering
              someone else&apos;s Sleeper username in a tool causes us to fetch their
              public league data too; only do that where it is appropriate.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Assistant questions
            </h3>
            <p className="mt-2">
              When you ask BEAM a question, we log the question so we can see what the
              assistant could not answer and improve it. The text is scrubbed of things
              that look like contact details or long digit strings before it is stored,
              and it is linked to your account only if you were signed in. BEAM answers
              from our own data with our own code; your question is{" "}
              <strong className="text-ink">not</strong> sent to an external language
              model provider.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Donations
            </h3>
            <p className="mt-2">
              Donations are processed by Stripe, PayPal, or Venmo. Your card number,
              wallet token, and bank details go to that processor and never to us. We do
              not store any payment instrument. If you were signed in we pass Stripe
              your email address so it can prefill its own form.
            </p>
            <p className="mt-2">
              When a donation through Stripe completes, Stripe notifies our server and
              we send you a receipt by email. To do that we keep one record per
              donation containing the amount, the Stripe identifiers for the payment,
              which page the donation started from, and whether the receipt was sent.
              That record deliberately does{" "}
              <strong className="text-ink">not</strong> include your email address,
              your name, your billing address, or anything about your card. Your email
              address is read from Stripe&apos;s notification, used to address the
              receipt, and then discarded. Stripe keeps the full record of the payment,
              including your details, under its own policy, and the same is true of
              PayPal and Venmo if you use those instead.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Cookies and similar storage
            </h3>
            <p className="mt-2">
              We use first-party cookies and similar browser storage to keep you signed
              in (Supabase auth cookies), to remember your format and source preferences
              across visits, to hold a guest identifier so a game can tell whether you
              have already voted, and to cache transient interface state.
            </p>
            <p className="mt-2">
              We do not build cross-site profiles of you ourselves. The one third party
              that may set cookies in your browser here is Google, when it serves an
              ad, and the Advertising block just below explains what those cookies do
              and how to opt out of personalized ads. You can clear our cookies at any
              time from your browser settings; clearing them signs you out and resets
              your preferences.
            </p>

            <h3 id="advertising" className="mt-4 text-base font-semibold text-ink">
              Advertising
            </h3>
            <p className="mt-2">
              {SITE.name} is free to use, and advertising is how the hosting bill gets
              paid. Any ads on the site are served by Google AdSense. When an ad is shown,
              third-party vendors, including Google, use cookies to serve ads based on
              your prior visits to this website or to other websites. Google&apos;s use
              of advertising cookies enables it and its partners to serve ads to you
              based on your visit to this site and other sites on the Internet.
            </p>
            <p className="mt-2">
              You can opt out of personalized advertising by visiting{" "}
              <ExternalLink href="https://www.google.com/settings/ads">
                Google&apos;s Ads Settings
              </ExternalLink>
              . You can also opt out of some other third-party vendors&apos; use of
              cookies for personalized advertising at{" "}
              <ExternalLink href="https://www.aboutads.info/choices/">
                www.aboutads.info/choices
              </ExternalLink>
              . Opting out does not remove ads; it stops them being chosen from your
              browsing history.
            </p>
            <p className="mt-2">
              Google explains what it collects when it serves an ad on a site like this
              one at{" "}
              <ExternalLink href="https://policies.google.com/technologies/partner-sites">
                How Google uses information from sites or apps that use our services
              </ExternalLink>
              . The ad technology providers Google may work with are listed at{" "}
              <ExternalLink href="https://support.google.com/admanager/answer/9012903">
                Google&apos;s ad technology providers page
              </ExternalLink>
              . We do not pass Google your name, your email address, or anything else
              that identifies you; what an ad request carries is what your browser sends
              to any website (an IP address and browser details) plus the page you are
              on.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Technical and abuse-prevention data
            </h3>
            <p className="mt-2">
              Our hosting provider (Vercel) automatically logs basic request
              information, including IP address, user agent, request path, and response
              status, for security and operational troubleshooting.
            </p>
            <p className="mt-2">
              Some public endpoints are rate limited so one visitor cannot exhaust them.
              Where you are signed in, the limit is counted against your account
              identifier. Where you are not, we count it against a{" "}
              <strong className="text-ink">salted one-way hash</strong> of your IP
              address. We store the hash, not the address, and the hash cannot be
              reversed back to an IP.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Analytics
            </h3>
            <p className="mt-2">
              We use Vercel Analytics to count page views and see which pages are
              used. It sets no cookie and builds no profile of you across sites or
              visits.
            </p>

            <h3 className="mt-4 text-base font-semibold text-ink">
              Discord polls
            </h3>
            <p className="mt-2">
              If you vote on one of our polls in Discord, we record your Discord user
              identifier against that poll so that one person is counted once. We do not
              publish who voted, and we do not link Discord poll votes to your{" "}
              {SITE.name} account.
            </p>
          </section>

          <section aria-labelledby="why">
            <h2 id="why" className="text-2xl font-semibold tracking-tight text-ink">
              2. Why we collect it, and our legal basis
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                To authenticate you and keep you signed in. Basis: performance of a
                contract with you.
              </li>
              <li>
                To save the preferences that personalize the product. Basis: performance
                of a contract.
              </li>
              <li>
                To power features that need league data (League Pulse, Power Pulse, the
                power-rankings table, the trade analyzer, Manager Pulse, the transaction
                feed). Basis: performance of a contract.
              </li>
              <li>
                To pass a donation you choose to make to the payment processor that
                handles it. Basis: your consent, given by choosing to donate. A
                donation is a gift rather than a purchase, so there is no contract
                here to perform.
              </li>
              <li>
                To prevent abuse, rate-limit expensive endpoints, and keep the service
                available. Basis: our legitimate interest in a service that stays up.
              </li>
              <li>
                To understand which pages are used, in aggregate. Basis: our legitimate
                interest in improving the product.
              </li>
              <li>
                To send email digests, if and only if you explicitly opted in. Basis:
                your consent, which you can withdraw at any time.
              </li>
              <li>
                To show advertising that keeps the site free. Basis: our legitimate
                interest in paying for the service without a paywall, and, where local
                law requires it for personalized ads, your consent, which you can
                withdraw through the opt-out links in the Advertising block above.
              </li>
            </ul>
          </section>

          <section aria-labelledby="who">
            <h2 id="who" className="text-2xl font-semibold tracking-tight text-ink">
              3. Who we share it with
            </h2>
            <p className="mt-3">
              We do not sell, rent, or trade your personal information. The list below
              is every third party involved in running the product, and they are not
              all the same kind of party. Some process data on our instructions. Some
              are independent of us and decide for themselves what they do with what
              you give them. Some receive nothing about you at all. Each entry says
              which:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                <strong className="text-ink">Supabase</strong>, managed PostgreSQL,
                authentication, and file storage. Processes on our instructions.
                Stores your account, preferences, posted content, and synced league
                data.
              </li>
              <li>
                <strong className="text-ink">Vercel</strong>, hosting, edge network, and
                the cookie-free analytics described above.
              </li>
              <li>
                <strong className="text-ink">Stripe</strong>, card and digital wallet
                payments for donations. Stripe acts as an independent controller of the
                payment data you give it directly, not on our instructions, and uses it
                for payment processing and fraud prevention under its own policy.
              </li>
              <li>
                <strong className="text-ink">PayPal</strong> and{" "}
                <strong className="text-ink">Venmo</strong>, only if you choose one of
                those donation buttons. You leave our site to complete the payment on
                theirs, and they receive whatever their own flow collects.
              </li>
              <li>
                <strong className="text-ink">Resend</strong>, transactional and digest
                email delivery, including donation receipts. Processes on our
                instructions, and receives the recipient address and the message.
              </li>
              <li>
                <strong className="text-ink">Google</strong> and{" "}
                <strong className="text-ink">Discord</strong>, only when you choose to
                sign in with one of them. They receive the fact that you authenticated
                against the {SITE.name} app; we receive the profile fields listed above.
                Discord additionally receives poll interactions you make in our server.
              </li>
              <li>
                <strong className="text-ink">Google AdSense</strong>, which serves the
                ads. Google acts as an independent controller of what its advertising
                cookies collect, under its own policy, and the Advertising block in
                section 1 says how to opt out of personalized ads. We receive aggregate
                reporting from it (how many ads were shown and clicked), never a list
                of who saw them.
              </li>
              <li>
                <strong className="text-ink">Anthropic</strong>, whose language models
                help draft parts of the Beacon Brief and some analytical commentary from
                public NFL news and our own data. No personal information about you is
                sent to it.
              </li>
              <li>
                <strong className="text-ink">Sleeper</strong>,{" "}
                <strong className="text-ink">KeepTradeCut</strong>,{" "}
                <strong className="text-ink">FantasyCalc</strong>,{" "}
                <strong className="text-ink">DynastyProcess</strong>, odds providers,
                and <strong className="text-ink">GIPHY</strong>. We read from their
                public interfaces from our own servers. We do not send them anything
                about you, your browser does not contact them directly for this content,
                and they do not know who is browsing our site.
              </li>
            </ul>
            <p className="mt-3">
              We may disclose information if compelled by lawful process, or where
              necessary to protect the rights, property, or safety of {SITE.name}, our
              users, or the public. If the Service is ever transferred to a new owner,
              account data may transfer with it, and we will say so on this page before
              it takes effect.
            </p>
          </section>

          <section aria-labelledby="transfers">
            <h2 id="transfers" className="text-2xl font-semibold tracking-tight text-ink">
              4. Where your data is processed
            </h2>
            <p className="mt-3">
              {SITE.name} is operated from the United States and our providers process
              data in the United States and, for edge delivery, in other regions. If you
              are in the European Economic Area, the United Kingdom, or Switzerland,
              this means your information is transferred outside your home country. Our
              providers rely on the European Commission&apos;s Standard Contractual
              Clauses or an equivalent transfer mechanism for those transfers.
            </p>
          </section>

          <section aria-labelledby="google">
            <h2 id="google" className="text-2xl font-semibold tracking-tight text-ink">
              5. Google API Services User Data Policy
            </h2>
            <p className="mt-3">
              {SITE.name}&apos;s use and transfer of information received from Google
              APIs to any other app will adhere to the{" "}
              <ExternalLink href="https://developers.google.com/terms/api-services-user-data-policy">
                Google API Services User Data Policy
              </ExternalLink>
              , including the Limited Use requirements. We use the data we receive
              solely to authenticate you and to populate your profile (name, email,
              avatar). We do not transfer this data to third parties for any purpose
              other than the providers named above, do not use it for advertising, do
              not use it to train machine learning models, and do not allow humans to
              read it unless we have your explicit consent or it is necessary for
              security or to comply with applicable law.
            </p>
          </section>

          <section aria-labelledby="retention">
            <h2 id="retention" className="text-2xl font-semibold tracking-tight text-ink">
              6. How long we keep it
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                Account and preference data: while your account is active, and deleted
                when you ask us to delete the account.
              </li>
              <li>
                Public Signal profile content: until you delete it or the account,
                allowing for backup copies to age out.
              </li>
              <li>
                Synced public Sleeper league data: while the league remains in use, or
                until you request removal of the leagues you brought in.
              </li>
              <li>
                Donation records: kept indefinitely as a financial record, but they
                identify nobody. A row holds an amount, Stripe&apos;s identifiers, and
                whether we managed to email a receipt. It contains no name, no email
                address, and no payment details.
              </li>
              <li>
                The payment itself, including your name, email address, and billing
                details, lives with the payment processor for as long as its own legal
                obligations require. We can neither delete nor amend that copy on your
                behalf; to have it removed you would need to ask the processor
                directly.
              </li>
              <li>
                Rate-limit hashes: short-lived, and expire with their window.
              </li>
              <li>
                Advertising cookies: set and expired by Google under its own policy.
                We hold none of them, and clearing your browser&apos;s cookies removes
                them.
              </li>
              <li>
                Hosting request logs: retained by our hosting provider on a rolling
                short-term basis, typically 30 days.
              </li>
            </ul>
          </section>

          <section aria-labelledby="rights">
            <h2 id="rights" className="text-2xl font-semibold tracking-tight text-ink">
              7. Your rights and choices
            </h2>
            <p className="mt-3">Whoever and wherever you are, you can:</p>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                View and change your preferences (format, source, Sleeper username,
                theme, email opt-in) from your dashboard.
              </li>
              <li>Disconnect Sleeper sync by clearing your Sleeper username.</li>
              <li>Delete your Signal profile and anything posted to it.</li>
              <li>Unsubscribe from the email digest using the link in any message it sends.</li>
              <li>
                Request a copy of the personal data we hold about you, ask us to correct
                it, or ask us to delete your account, by emailing {CONTACT}. We will
                respond within 30 days and will not charge you or treat you differently
                for asking.
              </li>
              <li>
                Revoke OAuth access to {SITE.name} from your Google account settings or
                your Discord authorized-apps page at any time.
              </li>
            </ul>
            <p className="mt-3">
              <strong className="text-ink">If you are in the EEA, the UK, or
              Switzerland</strong>, you also have the rights to object to processing
              based on legitimate interests, to restrict processing, to data
              portability, to withdraw consent at any time without affecting prior
              processing, and to complain to your local supervisory authority.
            </p>
            <p className="mt-3">
              <strong className="text-ink">If you are in California</strong>, you have
              the rights to know, delete, and correct, and the right to opt out of sale
              or sharing. We do not sell personal information and have not done so in
              the preceding twelve months. Personalized advertising served by Google may
              count as &quot;sharing&quot; as the CCPA defines it, and the opt-out for
              it is the one in the Advertising block in section 1, because Google is
              the party holding the data. We do not knowingly sell or share the personal
              information of anyone under 16. We do not yet act on the Global Privacy
              Control browser signal automatically; use the opt-out links above, and
              this page will say so when that changes.
            </p>
          </section>

          <section aria-labelledby="security">
            <h2 id="security" className="text-2xl font-semibold tracking-tight text-ink">
              8. Security
            </h2>
            <p className="mt-3">
              We protect data with HTTPS in transit, encryption at rest via Supabase,
              row-level security so an account can only read and write its own records,
              server-side authorization checks on the endpoints that change data,
              hashed identifiers in the abuse-prevention ledger, and rate limits on
              public and admin endpoints. Card data never reaches our servers at all.
            </p>
            <p className="mt-3">
              No system is perfectly secure. Use a strong, unique passphrase on
              whichever provider you sign in with, and turn on its two-factor
              authentication. If we become aware of a breach affecting your personal
              data, we will notify you and any required regulator without undue delay.
              If you think you have found a vulnerability, email {CONTACT} rather than
              posting it publicly.
            </p>
          </section>

          <section aria-labelledby="children">
            <h2 id="children" className="text-2xl font-semibold tracking-tight text-ink">
              9. Children
            </h2>
            <p className="mt-3">
              {SITE.name} is not directed to children under 13 and we do not knowingly
              collect personal information from them. If you are a parent or guardian
              and believe a child has given us personal data, email {CONTACT} and we
              will delete it.
            </p>
          </section>

          <section aria-labelledby="changes">
            <h2 id="changes" className="text-2xl font-semibold tracking-tight text-ink">
              10. Changes to this Policy
            </h2>
            <p className="mt-3">
              We may update this Privacy Policy from time to time. When we do, we will
              update the &quot;Effective&quot; date at the top of this page. Material
              changes will be highlighted on the homepage or through an in-app notice
              before they take effect.
            </p>
          </section>

          <section aria-labelledby="contact">
            <h2 id="contact" className="text-2xl font-semibold tracking-tight text-ink">
              11. Contact
            </h2>
            <p className="mt-3">
              Questions, requests, or complaints go to {CONTACT}. You can also reach us
              through the contact form on the{" "}
              <Link
                href="/about"
                className="text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                About page
              </Link>
              . The data controller is {OPERATOR}, operating {SITE.name} in the United
              States.
            </p>
          </section>
        </article>
      </PageBody>
    </main>
  );
}
