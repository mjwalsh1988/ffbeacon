/**
 * Safe JSON-LD serialization for injection into an inline
 * `<script type="application/ld+json">` block (FFB-SEC-006).
 *
 * Plain `JSON.stringify` escapes quotes and backslashes but NOT the characters that
 * matter inside an HTML script element: `<`, `>`, and `&`. A value containing the
 * sequence `</script>` would therefore terminate the script element and allow an
 * injected `<script>` to execute. Because our JSON-LD interpolates externally
 * influenced values (AI-generated Beacon Brief titles, Sleeper-sourced player fields),
 * every emitter MUST route through this helper instead of `JSON.stringify`.
 *
 * The escaped characters only ever appear inside JSON string values (never in JSON
 * structural syntax), so replacing them with their `\uXXXX` escapes keeps the output
 * valid JSON and valid JSON-LD while making it impossible to break out of the script
 * element. U+2028 / U+2029 are also escaped: they are legal in JSON strings but are
 * line terminators in HTML/JS parsing contexts.
 */

import { SITE, SOCIAL_LINKS } from "@/lib/site";

// Built from string escapes so the source stays pure ASCII.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const SCRIPT_BREAKOUT = new RegExp("[<>&\\u2028\\u2029]", "g");

const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  [LINE_SEPARATOR]: "\\u2028",
  [PARAGRAPH_SEPARATOR]: "\\u2029",
};

/**
 * Serialize a JSON-LD object to a string that is safe to place inside a
 * `dangerouslySetInnerHTML` script body. Returns valid JSON.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(SCRIPT_BREAKOUT, (c) => ESCAPES[c]);
}

/**
 * Site-wide entity schema, emitted once from the root layout so every page
 * carries the same Organization and WebSite facts. Pure builders: no fetch,
 * no request context, just SITE and SOCIAL_LINKS turned into schema.org
 * shapes with every URL resolved to an absolute one against SITE.url.
 *
 * Deliberately no SearchAction on the WebSite entity. The site search is a
 * command palette with no query-string URL, so a SearchAction would have to
 * invent an endpoint that does not exist.
 */

export type OrganizationJsonLd = {
  "@context": "https://schema.org";
  "@type": "Organization";
  name: string;
  url: string;
  logo: string;
  sameAs: string[];
  founder: {
    "@type": "Person";
    name: string;
    url: string;
  };
};

export function organizationJsonLd(): OrganizationJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    url: SITE.url,
    logo: `${SITE.url}/img/ff-beacon-logo.png`,
    sameAs: SOCIAL_LINKS.filter((link) => !link.disabled).map((link) =>
      link.href.startsWith("/") ? `${SITE.url}${link.href}` : link.href,
    ),
    founder: {
      "@type": "Person",
      name: SITE.author.name,
      url: `${SITE.url}${SITE.author.bylineHref}`,
    },
  };
}

export type WebSiteJsonLd = {
  "@context": "https://schema.org";
  "@type": "WebSite";
  name: string;
  url: string;
};

export function websiteJsonLd(): WebSiteJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
  };
}

/**
 * Person schema for a user-controlled profile page (Signal). Unlike
 * organizationJsonLd's fixed founder record, every field here is data a user
 * chose to publish, so the shape is minimal and every optional field is
 * omitted rather than emitted empty: an absent `image` or `sameAs` is not the
 * same claim as an empty string or array. Mirrors the shape used by
 * app/author/michael/page.tsx's inline Person schema without importing it,
 * since that page's schema carries fields (jobTitle, worksFor, knowsAbout)
 * that are specific to the site's own author bio, not to a Signal profile.
 */
export type PersonJsonLd = {
  "@context": "https://schema.org";
  "@type": "Person";
  name: string;
  url: string;
  image?: string;
  sameAs?: string[];
};

export function personJsonLd(person: {
  name: string;
  url: string;
  image?: string | null;
  sameAs?: string[];
}): PersonJsonLd {
  const out: PersonJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person.name,
    url: person.url,
  };
  if (person.image) out.image = person.image;
  if (person.sameAs && person.sameAs.length > 0) out.sameAs = person.sameAs;
  return out;
}

/**
 * ItemList schema for an ordered list of linked entities (a Signal ranking
 * board's ranked players). `position` is 1-based per schema.org convention,
 * which is already how a rank column reads, so callers pass their own rank
 * straight through rather than the array index.
 */
export type ItemListJsonLd = {
  "@context": "https://schema.org";
  "@type": "ItemList";
  itemListElement: {
    "@type": "ListItem";
    position: number;
    url: string;
    name: string;
  }[];
};

export function itemListJsonLd(
  items: { position: number; url: string; name: string }[],
): ItemListJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item) => ({
      "@type": "ListItem",
      position: item.position,
      url: item.url,
      name: item.name,
    })),
  };
}

/**
 * WebApplication schema for a free tool or game page (site SEO audit,
 * section 4.3 item 10). Every tool and game is free, so `offers` is fixed
 * at price "0" rather than taken as a parameter: there is no plan on this
 * site that costs money, so there is nothing for a caller to get wrong.
 *
 * `category` is the finished schema.org value, not a tool-vs-game flag:
 * pass "SportsApplication" from a page under app/tools/*, "GameApplication"
 * from a page under app/games/*.
 *
 * Deliberately no `aggregateRating`. Google tightened review-snippet
 * guidance on 2026-07-24 around self-serving ratings, and a rating FF
 * Beacon collected about its own tool is exactly the pattern it targets.
 */
export type WebApplicationJsonLd = {
  "@context": "https://schema.org";
  "@type": "WebApplication";
  name: string;
  description: string;
  url: string;
  applicationCategory: string;
  operatingSystem: "Any";
  offers: {
    "@type": "Offer";
    price: "0";
    priceCurrency: "USD";
  };
  dateModified?: string;
};

export function webApplicationJsonLd({
  name,
  description,
  url,
  category,
  dateModified,
}: {
  name: string;
  description: string;
  /** Canonical path (leading slash) or an already-absolute URL. */
  url: string;
  /** The finished schema.org applicationCategory value. */
  category: string;
  dateModified?: string;
}): WebApplicationJsonLd {
  const out: WebApplicationJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name,
    description,
    url: url.startsWith("http") ? url : `${SITE.url}${url}`,
    applicationCategory: category,
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };
  if (dateModified) out.dateModified = dateModified;
  return out;
}
