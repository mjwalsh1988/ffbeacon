import type { Metadata } from "next";
import Link from "next/link";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/terms" },
  title: "Terms of Service",
  description:
    "The rules and expectations for using FF Beacon: what you can do, what we expect, how donations work, and how the service is provided.",
};

const EFFECTIVE_DATE = "September 6, 2026";
const EFFECTIVE_DATE_ISO = "2026-09-06";

/** Every section, in order, for the contents list. Ids match the headings below. */
const SECTIONS: Array<{ id: string; label: string }> = [
  { id: "eligibility", label: "Eligibility" },
  { id: "accounts", label: "Accounts and authentication" },
  { id: "what-it-is", label: "What the Service is, and what it is not" },
  { id: "acceptable-use", label: "Acceptable use" },
  { id: "your-content", label: "Your content" },
  { id: "copyright", label: "Copyright complaints" },
  { id: "third-party", label: "Third-party data, and who we are not affiliated with" },
  { id: "community", label: "The Discord community" },
  { id: "donations", label: "Donations" },
  { id: "availability", label: "Availability, changes, and experimental features" },
  { id: "ip", label: "Intellectual property" },
  { id: "termination", label: "Termination" },
  { id: "warranty", label: "Disclaimers and limitation of liability" },
  { id: "indemnity", label: "Indemnification" },
  { id: "disputes", label: "Governing law and disputes" },
  { id: "changes", label: "Changes to these Terms" },
  { id: "general", label: "General" },
  { id: "contact", label: "Contact" },
];

const LINK =
  "text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
const OPERATOR = SITE.author.legalName;
const STATE = SITE.governingState;
const CONTACT = SITE.legalContactEmail;

/**
 * /terms
 *
 * Written to be read, not skimmed past. Every section says one thing, in the
 * order a person actually meets it: who this is with, whether they can use it,
 * what the thing is and is not, what they may not do, what happens to anything
 * they post, how a donation works, and then the parts that only matter when
 * something has gone wrong.
 *
 * The operator is named with a full legal name rather than the site byline,
 * because this is a contract. The governing state, the operator and the contact
 * address all come from lib/site.ts, so the two legal pages cannot end up
 * naming different parties.
 */
export default function TermsPage() {
  return (
    <main id="main">
      <PageBody width="reading">
        <PageMasthead
          eyebrow="Legal"
          title="Terms of Service"
          description={
            <>
              Effective <time dateTime={EFFECTIVE_DATE_ISO}>{EFFECTIVE_DATE}</time>
            </>
          }
        />
        <article className="mt-8 space-y-8 text-ink-muted">
          <p>
            These Terms of Service (&quot;Terms&quot;) are an agreement between you and{" "}
            {OPERATOR}, an individual doing business as {SITE.name} (&quot;we&quot;,
            &quot;us&quot;), and they govern your access to and use of {SITE.name} and
            everything on it (&quot;the Service&quot;). By using the Service you agree to
            these Terms. If you do not agree, please do not use the Service.
          </p>
          <p>
            Two sections deserve reading in full rather than scanning:{" "}
            <a href="#warranty" className={LINK}>
              section 13, disclaimers and limitation of liability
            </a>
            , and{" "}
            <a href="#donations" className={LINK}>
              section 9, donations
            </a>
            , which explains that donations are final. Neither is hidden and neither is
            unusual, but both change what you can expect if something goes wrong.
          </p>

          {/* A CONTENTS LIST, because eighteen sections of contract with no way to
              jump is a document a screen reader user has to walk end to end to find
              one clause in. A real nav landmark holding a real ordered list, so it
              appears in a rotor alongside the headings. */}
          <nav
            aria-labelledby="toc-heading"
            className="rounded-card border border-line bg-base/40 p-4"
          >
            <h2 id="toc-heading" className="text-sm font-semibold text-ink">
              What is in these Terms
            </h2>
            <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
              {SECTIONS.map(({ id, label }, i) => (
                <li key={id}>
                  <a href={`#${id}`} className={LINK}>
                    {i + 1}. {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <section aria-labelledby="eligibility">
            <h2 id="eligibility" className="text-2xl font-semibold tracking-tight text-ink">
              1. Eligibility
            </h2>
            <p className="mt-3">
              You must be at least 13 years old to use the Service. If you are under
              18, you may use it only with the involvement of a parent or guardian who
              agrees to these Terms on your behalf. By creating an account you confirm
              that you meet this age requirement and that the information you provide is
              accurate.
            </p>
          </section>

          <section aria-labelledby="accounts">
            <h2 id="accounts" className="text-2xl font-semibold tracking-tight text-ink">
              2. Accounts and authentication
            </h2>
            <p className="mt-3">
              Account creation is optional and most of the Service works without one.
              When you choose to sign in, you may authenticate through third-party
              providers (currently Google and Discord) or via an email link. We rely on
              those providers&apos; own terms and security; their handling of your
              credentials is governed by their respective terms and privacy policies.
            </p>
            <p className="mt-3">
              You are responsible for keeping your authentication method secure, which
              means your email inbox, your Google account, or your Discord account. You
              agree to notify us at {CONTACT} promptly if you believe your account has
              been accessed by someone else. You may not share an account, sell one, or
              use another person&apos;s account.
            </p>
          </section>

          <section aria-labelledby="what-it-is">
            <h2 id="what-it-is" className="text-2xl font-semibold tracking-tight text-ink">
              3. What the Service is, and what it is not
            </h2>
            <p className="mt-3">
              {SITE.name} publishes fantasy football analysis: player values, rankings,
              projections, trade grades, league summaries, and written commentary. All
              of it is opinion and estimation produced from public data. It is offered
              for information and entertainment.
            </p>
            <p className="mt-3">
              <strong className="text-ink">It is not advice.</strong> Nothing on the
              Service is financial, investment, legal, tax, or professional advice, and
              nothing on it is a recommendation to place a wager. Some
              pages display betting market data such as game totals and spreads, which
              are shown because they are useful inputs to a projection. They are not a
              tip, a prediction, or an inducement to gamble, and we take no part in any
              wagering. Gambling laws differ by state and country and complying with
              yours is your responsibility. If gambling is causing you harm, help is
              available in the US at 1-800-GAMBLER.
            </p>
            <p className="mt-3">
              <strong className="text-ink">Some content is AI-assisted.</strong> Parts
              of the Beacon Brief and some analytical commentary are drafted with the
              help of automated language models working from public NFL news and our own
              data, then published under our editorial responsibility. Automated systems
              make mistakes, including confident ones. Check anything that matters
              before acting on it.
            </p>
            <p className="mt-3">
              Every roster decision you make is yours. You are responsible for your own
              lineups, trades, waiver bids, and league conduct.
            </p>
          </section>

          <section aria-labelledby="acceptable-use">
            <h2 id="acceptable-use" className="text-2xl font-semibold tracking-tight text-ink">
              4. Acceptable use
            </h2>
            <p className="mt-3">You agree not to:</p>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                Scrape, crawl, or otherwise harvest data from the Service in a way that
                interferes with other users or imposes a load disproportionate to a
                typical interactive session.
              </li>
              <li>
                Attempt to access accounts, leagues, or data that do not belong to you,
                including through credential stuffing, session hijacking, or social
                engineering.
              </li>
              <li>
                Probe, scan, or test the security of the Service, or interfere with it
                by denial of service, malware, or automated abuse. Good-faith security
                research reported privately to {CONTACT} is welcome and we will not
                pursue anyone who reports a genuine finding responsibly and does not
                access or destroy other people&apos;s data.
              </li>
              <li>
                Submit content, including Sleeper usernames, handles, team names, league
                names, profile text, and uploaded images, that is unlawful, abusive,
                harassing, hateful, sexually explicit, deceptive, or that infringes
                anyone&apos;s rights.
              </li>
              <li>
                Impersonate any person or organization, or claim an affiliation with
                {" "}{SITE.name} that you do not have.
              </li>
              <li>
                Use the Service or its output to train a machine learning model, or to
                build a competing product, without our prior written permission.
              </li>
              <li>
                Circumvent rate limits, quotas, or the admin and commissioner
                force-refresh controls, or use automated means to create accounts or
                submit content.
              </li>
              <li>
                Remove, obscure, or alter any attribution, notice, or branding on the
                Service.
              </li>
            </ul>
            <p className="mt-3">
              We may remove content and suspend access for a breach of this section
              without notice where the breach is causing harm.
            </p>
          </section>

          <section aria-labelledby="your-content">
            <h2 id="your-content" className="text-2xl font-semibold tracking-tight text-ink">
              5. Your content
            </h2>
            <p className="mt-3">
              Some parts of the Service let you post: a Signal profile and its handle,
              posts and images on it, questions submitted through the guide and contact
              forms, and votes and feedback inside the games. You keep ownership of
              everything you post.
            </p>
            <p className="mt-3">
              By posting it you grant us a worldwide, non-exclusive, royalty-free
              license to host, store, reproduce, adapt for formatting, and display that
              content for the purpose of operating and promoting the Service. The
              license lasts as long as the content is on the Service, and it survives
              afterwards only to the extent that copies persist in backups or in caches
              we do not control. You confirm you have the rights to grant this for
              anything you post.
            </p>
            <p className="mt-3">
              A Signal profile is <strong className="text-ink">public</strong>. Its
              handle, display name, avatar, and posts can be read by anyone, indexed by
              search engines, and quoted elsewhere. Do not put anything on one that you
              would not want a stranger to read.
            </p>
            <p className="mt-3">
              If you send us feedback, a bug report, or a suggestion, we may use it
              without restriction and without owing you anything for it. That is not a
              claim over anything else you own.
            </p>
            <p className="mt-3">
              We do not pre-screen posted content and we are not obliged to monitor it,
              but we may remove anything at our discretion, particularly where it
              breaches section 4.
            </p>
          </section>

          <section aria-labelledby="copyright">
            <h2 id="copyright" className="text-2xl font-semibold tracking-tight text-ink">
              6. Copyright complaints
            </h2>
            <p className="mt-3">
              If you believe material on the Service infringes your copyright, email{" "}
              {CONTACT} with: your contact details, identification of the work you say
              is infringed, the URL of the material you want removed, a statement that
              you believe in good faith that the use is not authorized, a statement that
              the information in your notice is accurate and that you are the rights
              holder or authorized to act for them, and your physical or electronic
              signature. We will act on valid notices promptly, and we terminate the
              accounts of repeat infringers.
            </p>
          </section>

          <section aria-labelledby="third-party">
            <h2 id="third-party" className="text-2xl font-semibold tracking-tight text-ink">
              7. Third-party data, and who we are not affiliated with
            </h2>
            <p className="mt-3">
              The Service reads public information from third-party providers including
              the Sleeper API, KeepTradeCut, FantasyCalc, DynastyProcess, betting odds
              feeds, and the Sleeper player image CDN. We do not own that data, we
              cannot guarantee it is accurate or available, and a provider changing or
              withdrawing an interface may change or remove features here without
              notice.
            </p>
            <p className="mt-3">
              {SITE.name} is an independent project. It is not affiliated with,
              endorsed by, sponsored by, or connected to the National Football League,
              any NFL club, Sleeper, KeepTradeCut, FantasyCalc, Discord, or any other
              provider named on the site. Player names, team names, logos, and league
              marks belong to their respective owners and are used descriptively.
            </p>
            <p className="mt-3">
              By linking a Sleeper username to your account, or by entering one into a
              tool, you authorize the Service to fetch and store the public Sleeper data
              for the leagues that username belongs to, so that league sync, power
              rankings, trade analysis, and the other league tools can operate. You can
              disconnect this at any time by clearing your Sleeper username in your
              preferences. League data that other members of the same league can also
              see may remain visible to them.
            </p>
          </section>

          <section aria-labelledby="community">
            <h2 id="community" className="text-2xl font-semibold tracking-tight text-ink">
              8. The Discord community
            </h2>
            <p className="mt-3">
              Our Discord server is part of the Service for the purposes of these Terms,
              and section 4 applies there. It is also hosted by Discord and subject to
              Discord&apos;s own terms and community guidelines. Server moderators may
              remove messages and remove members. Help given in Discord is offered by
              volunteers and by us informally; it is opinion, not a service commitment.
            </p>
          </section>

          <section aria-labelledby="donations">
            <h2 id="donations" className="text-2xl font-semibold tracking-tight text-ink">
              9. Donations
            </h2>
            <p className="mt-3">
              {SITE.name} is free to use and is funded personally. You may make a
              voluntary one-time donation through the Service by card or digital wallet
              (processed by Stripe), or through PayPal or Venmo.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                <strong className="text-ink">A donation is a gift, not a purchase.</strong>{" "}
                It buys no product, no service, no feature, and no support commitment.
                Nothing on the Service is behind a paywall and donating does not unlock
                anything, change your rankings, or give you any influence over the data.
              </li>
              <li>
                <strong className="text-ink">Donations are final.</strong> Because
                nothing is being sold, there is nothing to return, and we do not offer
                refunds. If a payment is clearly a mistake, such as a duplicate charge
                or an amount that is obviously not what you intended, email {CONTACT} and
                we will try to put it right. That is a goodwill practice rather than a
                right you have under these Terms, and nothing here limits any refund or
                chargeback right you may have under your local consumer law or your
                card network&apos;s rules.
              </li>
              <li>
                <strong className="text-ink">It is not tax deductible.</strong>{" "}
                {SITE.name} is not a registered charity or a tax-exempt organization, and
                a donation is not a charitable contribution for tax purposes.
              </li>
              <li>
                <strong className="text-ink">We never see your card details.</strong>{" "}
                Card and wallet payments are handled entirely on Stripe&apos;s own
                systems; PayPal and Venmo payments are handled on theirs. Your payment
                is also subject to that processor&apos;s terms. See the{" "}
                <Link
                  href="/privacy"
                  className="text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Privacy Policy
                </Link>{" "}
                for what each one receives.
              </li>
              <li>
                Donations are one-time. We do not set up recurring charges and we do not
                store a payment method to reuse. We email you a receipt for a donation
                made by card or wallet; a donation sent through PayPal or Venmo is
                receipted by that service instead.
              </li>
              <li>
                We may decline or return a donation at our discretion, for example where
                a payment appears fraudulent.
              </li>
            </ul>
          </section>

          <section aria-labelledby="availability">
            <h2 id="availability" className="text-2xl font-semibold tracking-tight text-ink">
              10. Availability, changes, and experimental features
            </h2>
            <p className="mt-3">
              The Service is provided on an as-is, best-effort basis by one person. We
              may add, change, suspend, or remove features at any time, including data
              sources, rankings, tools, and League Pulse coverage. Some features are
              clearly labelled as new or experimental and may change or disappear
              without notice.
            </p>
            <p className="mt-3">
              We are not liable for downtime, data loss, or content that becomes
              unavailable because a third-party provider changed or withdrew an
              interface.
            </p>
          </section>

          <section aria-labelledby="ip">
            <h2 id="ip" className="text-2xl font-semibold tracking-tight text-ink">
              11. Intellectual property
            </h2>
            <p className="mt-3">
              The Service&apos;s name, logo, written content, design, and code are owned
              by {OPERATOR}. You may read, link to, and quote reasonable extracts with
              attribution. You may not reproduce, redistribute, or republish substantial
              parts of the Service, or use its content or output to train a machine
              learning model, without permission. Player names, team logos, NFL marks,
              and Sleeper avatars remain the property of their respective owners.
            </p>
          </section>

          <section aria-labelledby="termination">
            <h2 id="termination" className="text-2xl font-semibold tracking-tight text-ink">
              12. Termination
            </h2>
            <p className="mt-3">
              We may suspend or terminate your access to the Service if you breach these
              Terms, or where we reasonably need to in order to protect the Service or
              other users. You may stop using the Service and request account deletion
              at any time by emailing {CONTACT}; deletion removes your preferences,
              your Signal profile, and your voting history. Public Sleeper league data
              synced for a league persists for the other members of that league. Sections{" "}
              <a href="#your-content" className={LINK}>
                5
              </a>
              ,{" "}
              <a href="#donations" className={LINK}>
                9
              </a>
              ,{" "}
              <a href="#ip" className={LINK}>
                11
              </a>
              , and{" "}
              <a href="#warranty" className={LINK}>
                13
              </a>{" "}
              through{" "}
              <a href="#general" className={LINK}>
                17
              </a>{" "}
              survive termination.
            </p>
          </section>

          <section aria-labelledby="warranty">
            <h2 id="warranty" className="text-2xl font-semibold tracking-tight text-ink">
              13. Disclaimers and limitation of liability
            </h2>
            <p className="mt-3">
              To the fullest extent permitted by law, the Service is provided
              &quot;as is&quot; and &quot;as available&quot; without warranties of any
              kind, express or implied, including the implied warranties of
              merchantability, fitness for a particular purpose, title, and
              non-infringement. We do not warrant that the Service will be uninterrupted,
              secure, error free, or that any value, projection, ranking, or grade on it
              is accurate.
            </p>
            <p className="mt-3">
              To the fullest extent permitted by law, {OPERATOR} is not liable for any
              indirect, incidental, special, consequential, exemplary, or punitive
              damages, or for lost profits, lost data, or lost opportunities, arising
              from or relating to your use of the Service. That includes, without
              limitation, lost fantasy matchups, failed waiver bids, trade outcomes,
              league disputes, and any wager placed by anyone for any reason.
            </p>
            <p className="mt-3">
              To the fullest extent permitted by law, our total aggregate liability to
              you for all claims relating to the Service is limited to the greater of
              the total amount you paid or donated to us in the twelve months before the
              claim arose, or one hundred United States dollars.
            </p>
            <p className="mt-3">
              Some jurisdictions do not allow the exclusion of certain warranties or the
              limitation of certain damages. Where that is the case, the exclusions and
              limits above apply only to the extent permitted, and nothing in these
              Terms limits liability for fraud, for death or personal injury caused by
              negligence, or for anything else that cannot lawfully be limited.
            </p>
          </section>

          <section aria-labelledby="indemnity">
            <h2 id="indemnity" className="text-2xl font-semibold tracking-tight text-ink">
              14. Indemnification
            </h2>
            <p className="mt-3">
              You agree to indemnify and hold harmless {OPERATOR} from any claim,
              demand, loss, or expense, including reasonable legal fees, brought by a
              third party and arising from content you posted, your breach of these
              Terms, or your misuse of the Service. We will tell you promptly about any
              such claim and will not settle it in a way that admits fault on your
              behalf without your agreement.
            </p>
          </section>

          <section aria-labelledby="disputes">
            <h2 id="disputes" className="text-2xl font-semibold tracking-tight text-ink">
              15. Governing law and disputes
            </h2>
            <p className="mt-3">
              These Terms are governed by the laws of the State of {STATE}, United
              States, without regard to its conflict-of-laws rules. If your local
              consumer law gives you protections that cannot be contracted out of, this
              does not take those away.
            </p>
            <p className="mt-3">
              <strong className="text-ink">Talk to us first.</strong> If you have a
              dispute with us, email {CONTACT} with a description of it and what you
              would like to happen. We both agree to try in good faith to resolve it
              informally for sixty days from that email before starting any formal
              proceeding. Most problems end here.
            </p>
            <p className="mt-3">
              If that does not resolve it, any proceeding must be brought in the state
              or federal courts located in {STATE}, and we both consent to the personal
              jurisdiction of those courts. Either of us may still bring an individual
              claim in a small claims court that has jurisdiction. There is no
              mandatory arbitration in these Terms.
            </p>
          </section>

          <section aria-labelledby="changes">
            <h2 id="changes" className="text-2xl font-semibold tracking-tight text-ink">
              16. Changes to these Terms
            </h2>
            <p className="mt-3">
              We may update these Terms from time to time. When we do, we will update
              the &quot;Effective&quot; date at the top of this page. Material changes
              will be highlighted on the homepage or through an in-app notice before
              they take effect. Continued use after a change takes effect constitutes
              acceptance; if you do not accept a change, stop using the Service.
            </p>
          </section>

          <section aria-labelledby="general">
            <h2 id="general" className="text-2xl font-semibold tracking-tight text-ink">
              17. General
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-6">
              <li>
                <strong className="text-ink">Severability.</strong> If any part of these
                Terms is held unenforceable, that part is limited or removed to the
                minimum extent necessary and the rest stays in force.
              </li>
              <li>
                <strong className="text-ink">No waiver.</strong> If we do not enforce a
                provision, that is not a waiver of it.
              </li>
              <li>
                <strong className="text-ink">Assignment.</strong> You may not assign
                these Terms. We may assign them to a successor of the Service, and will
                say so on this page if we do.
              </li>
              <li>
                <strong className="text-ink">Entire agreement.</strong> These Terms and
                the Privacy Policy are the whole agreement between us about the Service
                and replace anything said before.
              </li>
              <li>
                <strong className="text-ink">Events outside our control.</strong> We are
                not responsible for failures caused by things we cannot reasonably
                control, including outages at hosting, data, or payment providers.
              </li>
              <li>
                <strong className="text-ink">Notices.</strong> We may contact you at the
                email address on your account or by a notice on the Service. You can
                reach us at {CONTACT}.
              </li>
              <li>
                <strong className="text-ink">No third-party beneficiaries.</strong>{" "}
                Nobody other than you and us has rights under these Terms.
              </li>
            </ul>
          </section>

          <section aria-labelledby="contact">
            <h2 id="contact" className="text-2xl font-semibold tracking-tight text-ink">
              18. Contact
            </h2>
            <p className="mt-3">
              Questions about these Terms, or anything else legal, go to {CONTACT}. You
              can also reach us through the contact form on the{" "}
              <Link
                href="/about"
                className="text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                About page
              </Link>
              .
            </p>
          </section>
        </article>
      </PageBody>
    </main>
  );
}
