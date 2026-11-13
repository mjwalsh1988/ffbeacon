import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import {
  Accessibility,
  ArrowRight,
  BookOpen,
  Bug,
  FileText,
  Handshake,
  Mail,
  MessagesSquare,
  Scale,
  ShieldCheck,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ContactPanel } from "@/components/contact-panel";
import { LinkTile } from "@/components/link-tile";
import { Panel } from "@/components/dashboard-panel";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { ORG_ID, serializeJsonLd } from "@/lib/json-ld";
import { pageShareMetadata } from "@/lib/page-og";
import { SITE } from "@/lib/site";

const DESCRIPTION =
  "How to reach FF Beacon: a contact form, a direct email address, and where to send a bug report, a wrong number, an accessibility problem or a privacy request.";

export const metadata: Metadata = {
  alternates: { canonical: "/contact" },
  // "Contact", not "Contact FF Beacon": the layout template appends the site
  // name, and the long form would print it twice in the browser tab.
  title: "Contact",
  description: DESCRIPTION,
  ...pageShareMetadata({
    key: "contact",
    title: "Contact FF Beacon",
    description: DESCRIPTION,
    path: "/contact",
  }),
};

/**
 * /contact
 *
 * The one page whose whole job is getting a message to a person. The form is
 * FIRST in the main column rather than in the rail, which is where About and
 * the author page keep theirs: the rail is second in DOM order, so on a phone
 * a rail form sits under everything else, and on this page the form is the
 * thing the reader came for.
 *
 * The form is the shared ContactPanel and posts to the same intake as the
 * others (/api/guide/submit) with page_key "contact", so there is still one
 * endpoint to keep hardened and one inbox to read. The key is registered in
 * lib/guide/registry.ts and seeded by migration 0378.
 *
 * Every sentence here describes something the site really does. There is no
 * reply-time promise, because one person answers the inbox and a number
 * written into a page is a number that gets broken in week 10.
 */

const EMAIL = SITE.legalContactEmail;

/** A mailto link with the subject already filled in, so the inbox sorts itself. */
function mailto(subject: string): string {
  return `mailto:${EMAIL}?subject=${encodeURIComponent(`${subject} (FF Beacon)`)}`;
}

type ContactRoute = {
  icon: LucideIcon;
  accent: "purple" | "cyan";
  title: string;
  body: string;
  /** What the link says. Unique per card, so a list of links reads sensibly. */
  action: string;
  href: string;
  /** True for a site path, false for a mailto link. */
  internal?: boolean;
};

const ROUTES: ContactRoute[] = [
  {
    icon: Bug,
    accent: "cyan",
    title: "Something is broken",
    body: "A page that will not load, a button that does nothing, a league that will not sync. Say which page and what you did just before it happened.",
    action: "Email a bug report",
    href: mailto("Bug report"),
  },
  {
    icon: Scale,
    accent: "purple",
    title: "A number looks wrong",
    body: "A value, a projection, a stat line or a trade grade that does not match what you know. Name the player, the format and the source you had selected.",
    action: "Email a data correction",
    href: mailto("Data correction"),
  },
  {
    icon: Accessibility,
    accent: "cyan",
    title: "An accessibility problem",
    body: "Something a screen reader skips, a control the keyboard cannot reach, text that is hard to read. This is the reason the site exists, so nothing is too small to report.",
    action: "Email an accessibility report",
    href: mailto("Accessibility report"),
  },
  {
    icon: MessagesSquare,
    accent: "purple",
    title: "A lineup or trade question",
    body: "Start or sit, accept or decline, how much to bid. The Discord is the fast route for these: other managers answer there, usually while the question still matters.",
    action: "Ask in the Discord",
    href: "/join",
    internal: true,
  },
  {
    icon: Handshake,
    accent: "cyan",
    title: "Press, partnerships and sponsorship",
    body: "Writing about the site, wanting to work together, or asking about sponsoring a tool or the Beacon Brief. Say who you are and what you have in mind. Anything sponsored would be labeled as sponsored on the page.",
    action: "Email about working together",
    href: mailto("Partnership"),
  },
  {
    icon: ShieldCheck,
    accent: "purple",
    title: "Privacy, your data and legal notices",
    body: "A request to see or delete what the site holds about you, a copyright concern, or a formal notice. Write from the email address on your account so the request can be matched to it.",
    action: "Email a privacy or legal request",
    href: mailto("Privacy or legal request"),
  },
];

const INCLUDE: Array<{ title: string; body: string }> = [
  {
    title: "The page address",
    body: "Copy it from the address bar. A league page address carries the league in it, which saves a round of questions.",
  },
  {
    title: "What you expected, and what happened instead",
    body: "Two sentences are enough. \"The trade graded as even and I expected it to favor my side\" is a report somebody can check.",
  },
  {
    title: "Your format and source",
    body: "Both are shown in the header, or in the menu on a phone. A value on one source in superflex is a different number from the same player on another source in one-quarterback, and both can be right.",
  },
  {
    title: "Your Sleeper username, for a league problem",
    body: "The username is public on Sleeper already and is all that is needed to open the same league you are looking at.",
  },
  {
    title: "Your device, browser and screen reader",
    body: "For anything about how a page behaves or reads aloud. \"NVDA with Chrome on Windows\" or \"VoiceOver on an iPhone\" is exactly the right level of detail.",
  },
];

type Answer = { question: string; answer: string; link?: { href: string; label: string } };

const ANSWERS: Answer[] = [
  {
    question: "Is FF Beacon free?",
    answer:
      "Yes. The rankings, the tools, the guides, the games and the Beacon Brief are free and there is no paid tier. The site is self funded and takes donations, which change nothing about what you can use.",
    link: { href: "/donate", label: "How donations work" },
  },
  {
    question: "Do I need an account?",
    answer:
      "Not for most of it. You can read the rankings, grade a trade and open a Sleeper league without signing in. An account is for the parts that save something: your Sleeper username, your own ranking boards, a public Signal profile, and your scores in the games.",
  },
  {
    question: "How do I delete my account or my data?",
    answer:
      "Write from the email address on the account and ask. The privacy policy lists what is stored, for how long, and what deleting it removes.",
    link: { href: "/privacy", label: "Read the privacy policy" },
  },
  {
    question: "Where do the values and projections come from?",
    answer:
      "Player values come from the value source you pick, and every source is named on the page that uses it. Projections and the league models are explained, with the arithmetic, in one guide.",
    link: { href: "/guides/how-ff-beacon-works", label: "How FF Beacon works" },
  },
  {
    question: "I donated by mistake, or twice. What now?",
    answer:
      "A donation is a gift and is final, but a duplicate charge or an amount you did not mean to send is a mistake rather than a gift. Email with the date and the amount and we will try to put it right.",
  },
  {
    question: "I have a question about a Personal Team Review order.",
    answer:
      "Reply to the receipt email, or write here from the address you ordered with. Signed in, your orders and anything delivered to them are listed in My Beacon.",
  },
  {
    question: "Who decides what the site says?",
    answer:
      "One person, and nobody pays to change it. The editorial policy covers who writes what, how the Beacon Brief is put together, and how a mistake gets corrected.",
    link: { href: "/editorial-policy", label: "Read the editorial policy" },
  },
];

const AFTER: Array<{ title: string; body: string }> = [
  {
    title: "It lands in one inbox",
    body: "The form and the email address go to the same place. There is no ticket system and no first line of support in front of it.",
  },
  {
    title: "A person reads it",
    body: "Michael builds the site and reads the inbox, so the reply comes from somebody who can open the code and fix the thing you found.",
  },
  {
    title: "You hear back if you left an address",
    body: "The form sends a confirmation straight away when you include your email, and the answer comes to that address. Without one the message is still read, but there is nowhere to reply to.",
  },
];

const LINK_CLASS =
  "text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export default function ContactPage() {
  const contactJsonLd = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: "Contact FF Beacon",
    description: DESCRIPTION,
    url: `${SITE.url}/contact`,
    mainEntity: {
      "@type": "Organization",
      "@id": ORG_ID,
      name: SITE.name,
      url: SITE.url,
      email: EMAIL,
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: EMAIL,
        url: `${SITE.url}/contact`,
        availableLanguage: "English",
      },
    },
  };

  return (
    <main id="main">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(contactJsonLd) }}
      />
      <PageBody flush>
        <PageMasthead
          eyebrow="Contact"
          title="Write to the person who builds it."
          description="FF Beacon is made by one fantasy manager, and the same person reads the inbox. Use the form, send an email, or pick the route below that matches what you need. A bug report, a number that looks wrong and a plain hello all end up in the same place."
        />
      </PageBody>

      <PageColumns
        railLabel="Email address and what happens next"
        rail={
          <>
            <Panel eyebrow="Direct" title="Email" headingLevel={2}>
              <p className="text-sm leading-relaxed text-ink-muted">
                Prefer your own mail app? Write to
              </p>
              <a
                href={`mailto:${EMAIL}`}
                className="mt-2 inline-flex min-h-11 items-center gap-2 break-all text-base font-semibold text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Mail aria-hidden="true" className="h-4 w-4 shrink-0" />
                {EMAIL}
              </a>
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                It is the same inbox the form reaches, and the address a reply comes
                from.
              </p>
            </Panel>

            <Panel eyebrow="After you send" title="What happens next" headingLevel={2}>
              <ol role="list" className="grid gap-3">
                {AFTER.map((step, index) => (
                  <li
                    key={step.title}
                    className="rounded-card border border-line bg-base/40 p-3"
                  >
                    {/* One real text node for the step number. An aria-hidden
                        digit with an sr-only twin reads fine line by line and
                        goes quiet for a screen reader following the pointer. */}
                    <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-brand-cyan">
                      Step {index + 1}
                    </span>
                    <span className="mt-1 block text-sm font-semibold text-ink">
                      {step.title}
                      <span className="sr-only">. </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                      {step.body}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel eyebrow="Elsewhere" title="Other places to look" headingLevel={2}>
              <div className="grid gap-2">
                <LinkTile
                  href="/join"
                  icon={Users}
                  title="The Discord"
                  body="Ask a lineup question and get an answer from a person."
                  accent="purple"
                />
                <LinkTile
                  href="/about"
                  icon={BookOpen}
                  title="About FF Beacon"
                  body="What the site is, who it is for, and what it costs. Nothing."
                />
                <LinkTile
                  href="/author/michael"
                  icon={UserCircle}
                  title="Who builds this"
                  body="Michael, twenty seasons in, and why the site was built this way."
                  accent="purple"
                />
                <LinkTile
                  href="/editorial-policy"
                  icon={FileText}
                  title="Editorial policy"
                  body="How the site is written, and what happens when a page is wrong."
                />
              </div>
            </Panel>
          </>
        }
      >
        <ContactPanel
          pageKey="contact"
          eyebrow="The form"
          title="Send a message"
          helper="No account needed. Leave an email address if you want an answer, and say as much or as little as you like."
          promptLabel="Your message"
          placeholder="What happened, or what would you like to know?"
        />

        <Panel
          eyebrow="Routes"
          title="Pick the route that fits"
          helper="Each email link opens your mail app with the subject already filled in, which gets the message to the right pile faster."
        >
          <ul role="list" className="grid gap-3 lg:grid-cols-2">
            {ROUTES.map((route) => (
              <RouteCard key={route.title} route={route} />
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="A good report"
          title="What makes a message easy to act on"
          helper="None of this is required. Each piece you include is one fewer question to send back."
        >
          <ul role="list" className="grid gap-2 lg:grid-cols-2">
            {INCLUDE.map((item) => (
              <li
                key={item.title}
                className="rounded-card border border-line bg-base/40 p-3"
              >
                <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">{item.body}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="Before you write"
          title="Answers to what people ask most"
          helper="The quickest reply is the one already on the page."
        >
          <div className="divide-y divide-line">
            {ANSWERS.map((item) => (
              <div key={item.question} className="py-4 first:pt-0 last:pb-0">
                <h3 className="text-sm font-semibold text-ink">{item.question}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                  {item.answer}
                </p>
                {item.link && (
                  <Link
                    href={item.link.href as Route}
                    className={`mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold ${LINK_CLASS}`}
                  >
                    {item.link.label}
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </PageColumns>
    </main>
  );
}

/* ---------- Pieces ---------- */

/** One reason to write, with the single action that goes with it. */
function RouteCard({ route }: { route: ContactRoute }) {
  const Icon = route.icon;
  const color = route.accent === "purple" ? "#A855F7" : "#22D3EE";
  const actionClass =
    "mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan underline hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
  return (
    <li
      className="relative flex flex-col overflow-hidden rounded-card border border-line bg-base/50 p-4 sm:p-5"
      style={{ boxShadow: `0 0 64px -46px ${color}99` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-px"
        style={{
          backgroundImage: `linear-gradient(180deg, transparent 0%, ${color} 30%, ${color}66 70%, transparent 100%)`,
        }}
      />
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-card border"
        style={{
          backgroundImage: `linear-gradient(135deg, ${color}26 0%, ${color}0D 100%)`,
          borderColor: `${color}59`,
          color,
        }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-3 text-base font-semibold text-ink">{route.title}</h3>
      <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-muted">{route.body}</p>
      {route.internal ? (
        <Link href={route.href as Route} className={actionClass}>
          {route.action}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      ) : (
        <a href={route.href} className={actionClass}>
          {route.action}
          <Mail aria-hidden="true" className="h-4 w-4" />
        </a>
      )}
    </li>
  );
}
