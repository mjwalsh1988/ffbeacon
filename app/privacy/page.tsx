import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What FF Beacon collects, why, who we share it with, and how to delete it.",
};

const EFFECTIVE_DATE = "May 18, 2026";

export default function PrivacyPage() {
  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            Legal
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="mt-3 text-sm text-ink-muted">Effective {EFFECTIVE_DATE}</p>
        </div>
      </header>
      <article className="mx-auto max-w-3xl space-y-8 px-4 py-10 text-ink-muted sm:px-6 lg:px-8">
        <p>
          This Privacy Policy describes what information {SITE.name}{" "}
          (&ldquo;we&rdquo;) collects when you visit the site, why we collect
          it, who we share it with, and the choices you have. We aim to collect
          the minimum data needed to make the product work.
        </p>

        <section aria-labelledby="what">
          <h2 id="what" className="text-2xl font-semibold tracking-tight text-ink">
            1. Information we collect
          </h2>
          <h3 className="mt-4 text-base font-semibold text-ink">
            Account information
          </h3>
          <p className="mt-2">
            When you sign in we receive a unique identifier and email address
            from the authentication provider you choose (currently Google or
            Discord; an email-link option may also be available). We do not
            receive or store your password.
          </p>
          <h3 className="mt-4 text-base font-semibold text-ink">
            Profile information
          </h3>
          <p className="mt-2">
            With your consent we may receive your display name and avatar from
            the OAuth provider. From Google: name, email, profile picture
            (scopes <code>openid email profile</code>). From Discord: username,
            avatar, and the email associated with your Discord account (scopes{" "}
            <code>identify email</code>). We do not access your Google Drive,
            Gmail, calendar, contacts, or any Discord server / message data.
          </p>
          <h3 className="mt-4 text-base font-semibold text-ink">
            Preferences and product data
          </h3>
          <p className="mt-2">
            We store the choices you make inside the product: your default
            fantasy format, default data source, theme, optional Sleeper
            username (for league sync), favorite players, vote history on
            matchups, and email digest opt-in.
          </p>
          <h3 className="mt-4 text-base font-semibold text-ink">
            Sleeper league data
          </h3>
          <p className="mt-2">
            When you link a Sleeper username, we pull and cache the public data
            Sleeper exposes for your leagues: league metadata, rosters,
            transactions, drafts, traded picks, and user display names within
            those leagues. This data is public on Sleeper and remains visible
            to other users of the same league inside our product.
          </p>
          <h3 className="mt-4 text-base font-semibold text-ink">
            Cookies and similar storage
          </h3>
          <p className="mt-2">
            We use cookies and similar browser storage to keep you signed in
            (Supabase auth cookies), to remember your format and source
            preferences across visits, and to cache transient UI state. These
            are first-party cookies; we do not use third-party advertising
            cookies. You can clear them at any time from your browser settings.
          </p>
          <h3 className="mt-4 text-base font-semibold text-ink">
            Technical data
          </h3>
          <p className="mt-2">
            Our hosting provider (Vercel) automatically logs basic request
            information — IP address, user agent, request path, response
            status — for security, abuse prevention, and operational
            troubleshooting. We use this data only for those purposes.
          </p>
        </section>

        <section aria-labelledby="why">
          <h2 id="why" className="text-2xl font-semibold tracking-tight text-ink">
            2. Why we collect it
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-6">
            <li>To authenticate you and keep you signed in.</li>
            <li>To save the preferences that personalize the product.</li>
            <li>
              To power features that need league data — League Pulse, the power-
              rankings table, the trade analyzer, the transaction feed.
            </li>
            <li>To prevent abuse and rate-limit force-refresh requests.</li>
            <li>
              To send you email digests if and only if you have explicitly
              opted in to email digests in your preferences.
            </li>
          </ul>
        </section>

        <section aria-labelledby="who">
          <h2 id="who" className="text-2xl font-semibold tracking-tight text-ink">
            3. Who we share it with
          </h2>
          <p className="mt-3">
            We do not sell, rent, or trade your personal information. We share
            data only with the third-party processors that make the product
            run:
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-6">
            <li>
              <strong className="text-ink">Supabase</strong> — managed
              PostgreSQL + authentication. Stores your account, preferences,
              and synced league data.
            </li>
            <li>
              <strong className="text-ink">Vercel</strong> — hosting and edge
              network. Processes requests and serves the site.
            </li>
            <li>
              <strong className="text-ink">Google</strong> and{" "}
              <strong className="text-ink">Discord</strong> — only when you
              choose to sign in with one of them. They receive the fact that
              you authenticated against the {SITE.name} app; we receive the
              profile fields listed above.
            </li>
            <li>
              <strong className="text-ink">Sleeper</strong>,{" "}
              <strong className="text-ink">KeepTradeCut</strong>,{" "}
              <strong className="text-ink">FantasyCalc</strong> — we read from
              their public APIs. We do not send them anything about you
              beyond the standard outbound HTTP request our server makes; they
              do not know who is browsing our site.
            </li>
          </ul>
          <p className="mt-3">
            We may disclose information if compelled by lawful process or to
            protect the rights, property, or safety of {SITE.name}, our users,
            or the public.
          </p>
        </section>

        <section aria-labelledby="google">
          <h2 id="google" className="text-2xl font-semibold tracking-tight text-ink">
            4. Google API Services User Data Policy
          </h2>
          <p className="mt-3">
            {SITE.name}&rsquo;s use and transfer of information received from
            Google APIs to any other app will adhere to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-cyan underline hover:text-brand-purple"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. We use the data we
            receive solely to authenticate you and to populate your profile
            (name, email, avatar). We do not transfer this data to third
            parties for any purpose other than the processors named above, do
            not use it for advertising, and do not allow humans to read the
            data unless we have your explicit consent or it&rsquo;s necessary
            for security or to comply with applicable law.
          </p>
        </section>

        <section aria-labelledby="retention">
          <h2 id="retention" className="text-2xl font-semibold tracking-tight text-ink">
            5. Data retention
          </h2>
          <p className="mt-3">
            Account and preference data is retained while your account is
            active. Synced public Sleeper league data is retained as long as
            the league remains active or until you request removal. Technical
            request logs are retained by our hosting provider on a rolling
            short-term basis (typically 30 days).
          </p>
        </section>

        <section aria-labelledby="rights">
          <h2 id="rights" className="text-2xl font-semibold tracking-tight text-ink">
            6. Your rights and choices
          </h2>
          <p className="mt-3">You can:</p>
          <ul className="mt-3 list-disc space-y-1 pl-6">
            <li>
              View and change your preferences (format, source, Sleeper
              username, theme, email opt-in) from the dashboard.
            </li>
            <li>
              Disconnect Sleeper sync by clearing your Sleeper username.
            </li>
            <li>
              Request a copy of the personal data we hold about you, or request
              account deletion, by contacting us through the Author page.
            </li>
            <li>
              Revoke OAuth access to {SITE.name} from your Google account
              settings or Discord authorized-apps page at any time.
            </li>
          </ul>
        </section>

        <section aria-labelledby="security">
          <h2 id="security" className="text-2xl font-semibold tracking-tight text-ink">
            7. Security
          </h2>
          <p className="mt-3">
            We protect data with industry-standard measures: HTTPS in transit,
            encryption at rest via Supabase, scoped database row-level
            security so users can only read and write their own preferences,
            and rate-limited admin endpoints. No system is perfectly secure;
            you should use a unique passphrase or password manager for the
            OAuth provider you use to sign in.
          </p>
        </section>

        <section aria-labelledby="children">
          <h2 id="children" className="text-2xl font-semibold tracking-tight text-ink">
            8. Children
          </h2>
          <p className="mt-3">
            {SITE.name} is not directed to children under 13 and we do not
            knowingly collect personal information from them. If you believe a
            child has provided us with personal data, contact us and we&rsquo;ll
            delete it.
          </p>
        </section>

        <section aria-labelledby="changes">
          <h2 id="changes" className="text-2xl font-semibold tracking-tight text-ink">
            9. Changes to this Policy
          </h2>
          <p className="mt-3">
            We may update this Privacy Policy from time to time. When we do,
            we&rsquo;ll update the &ldquo;Effective&rdquo; date at the top of
            this page. Material changes will be highlighted on the homepage or
            via an in-app notice.
          </p>
        </section>

        <section aria-labelledby="contact">
          <h2 id="contact" className="text-2xl font-semibold tracking-tight text-ink">
            10. Contact
          </h2>
          <p className="mt-3">
            Questions, requests, or complaints? Reach out through the contact
            channels on the Author page.
          </p>
        </section>
      </article>
    </main>
  );
}
