import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { AuthorPortrait } from "@/components/author-portrait";

export const metadata: Metadata = {
  title: "Michael, founder of FF Beacon",
  description:
    "Michael founded FF Beacon to bring accessibility-first fantasy football tools and analytics to everyone, especially players using screen readers.",
};

const personSchema = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Michael",
  jobTitle: "Founder, FF Beacon",
  description:
    "Twenty-year fantasy football player and blind dynasty manager who runs 50 leagues simultaneously by leaning on advanced stats.",
  url: `${SITE.url}/author/michael`,
  worksFor: {
    "@type": "Organization",
    name: SITE.name,
    url: SITE.url,
  },
  knowsAbout: [
    "Fantasy Football",
    "Dynasty Fantasy Football",
    "Best Ball",
    "Advanced Football Analytics",
    "Accessibility",
    "Screen Reader UX",
  ],
};

export default function AuthorMichaelPage() {
  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
      />
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-12 sm:flex-row sm:items-center sm:gap-8 sm:px-6 lg:px-8">
          <AuthorPortrait size={176} />
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
              Author
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Michael</h1>
            <p className="mt-3 text-lg text-ink-muted">
              Founder, FF Beacon. Twenty years in fantasy. One blind dynasty manager.
            </p>
          </div>
        </div>
      </header>
      <article className="mx-auto max-w-3xl space-y-8 px-4 py-10 text-lg leading-relaxed text-ink-muted sm:px-6 lg:px-8">
        <section aria-labelledby="story-heading">
          <h2 id="story-heading" className="sr-only">
            Story
          </h2>
          <p>
            I have been playing fantasy football since 2006. Twenty seasons. Most of those years I
            ran 1 or 2 leagues. Then in 2023, I started dynasty. The next year I was in 50 dynasty
            leagues at the same time. The reason was not free time. It was that I finally learned
            how to actually use the data.
          </p>
          <p>
            I am blind. That cuts both ways in fantasy. Every app I tried had friction that sighted
            users never notice. Stats trapped inside an unlabeled chart. Filters you can only reach
            with a mouse. Player news that does not announce when it updates. So I leaned on what
            does work for me: stat lines, target shares, snap counts, analyst tape breakdowns on
            audio, and advanced metrics that travel well as text.
          </p>
          <p>
            That accidentally made me a better fantasy player. I was already evaluating players the
            way successful managers do: from numbers and tape first, vibes last.
          </p>
        </section>

        <section aria-labelledby="why-heading">
          <h2 id="why-heading" className="text-2xl font-semibold tracking-tight text-ink">
            Why FF Beacon
          </h2>
          <p className="mt-4">
            Two things were obvious. First, there was a massive gap in fantasy resources for
            people who do not already speak analytics. Second, there was almost nothing built for
            fantasy players who use a screen reader.
          </p>
          <p>
            FF Beacon is my attempt to fix both. It is built accessibility-first. Every component is
            checked against keyboard navigation, semantic HTML, and screen reader announcements
            before it ships. And every guide explains the analytic before it asks you to use it.
          </p>
          <p>
            If you have ever felt locked out of fantasy football by either the jargon or the
            interface, this site is for you. Read me by ear or by eye. It works both ways.
          </p>
        </section>

        <section aria-labelledby="background-heading">
          <h2 id="background-heading" className="text-2xl font-semibold tracking-tight text-ink">
            Background
          </h2>
          <ul className="mt-4 space-y-2">
            <li>20 seasons of fantasy football, starting 2006</li>
            <li>3 seasons of dynasty, starting 2023</li>
            <li>50 dynasty leagues run simultaneously in 2024</li>
            <li>Marketing + development background that runs the technical side of FF Beacon</li>
          </ul>
        </section>

        <p className="text-sm text-ink-subtle">
          Want to talk about accessibility, fantasy, or analytics?{" "}
          <a href="mailto:hello@ffbeacon.com" className="text-ink underline-offset-4 hover:underline">
            hello@ffbeacon.com
          </a>
          .{" "}
          <Link href="/about" className="text-ink underline-offset-4 hover:underline">
            Read more about the site mission
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
