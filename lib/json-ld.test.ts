import { describe, expect, it } from "vitest";
import { SITE, SOCIAL_LINKS } from "@/lib/site";
import {
  itemListJsonLd,
  organizationJsonLd,
  personJsonLd,
  serializeJsonLd,
  websiteJsonLd,
  webApplicationJsonLd,
} from "@/lib/json-ld";

/**
 * The root-layout entity schema: one Organization, one WebSite. What matters
 * here is the shape (right @type, right keys) and that every URL the
 * builders emit is absolute against SITE.url, since a relative URL inside
 * JSON-LD has no page to resolve against.
 */
describe("organizationJsonLd", () => {
  it("has the Organization shape", () => {
    const org = organizationJsonLd();
    expect(org["@context"]).toBe("https://schema.org");
    expect(org["@type"]).toBe("Organization");
    expect(org.name).toBe(SITE.name);
  });

  it("resolves every URL absolute against SITE.url", () => {
    const org = organizationJsonLd();
    expect(org.url.startsWith(SITE.url)).toBe(true);
    expect(org.logo.startsWith(SITE.url)).toBe(true);
    expect(org.founder.url.startsWith(SITE.url)).toBe(true);
    for (const url of org.sameAs) {
      expect(url.startsWith("http")).toBe(true);
    }
  });

  it("points the founder at the author page", () => {
    const org = organizationJsonLd();
    expect(org.founder["@type"]).toBe("Person");
    expect(org.founder.url).toBe(`${SITE.url}${SITE.author.bylineHref}`);
  });

  it("carries one sameAs entry per non-disabled social link", () => {
    const org = organizationJsonLd();
    const expectedCount = SOCIAL_LINKS.filter((link) => !link.disabled).length;
    expect(org.sameAs).toHaveLength(expectedCount);
  });
});

describe("websiteJsonLd", () => {
  it("has the WebSite shape with no SearchAction", () => {
    const site = websiteJsonLd();
    expect(site["@context"]).toBe("https://schema.org");
    expect(site["@type"]).toBe("WebSite");
    expect(site.name).toBe(SITE.name);
    expect(site.url).toBe(SITE.url);
    expect(site).not.toHaveProperty("potentialAction");
  });
});

/**
 * The Signal profile Person schema: minimal by construction, so the tests
 * check that optional fields are actually omitted (not emitted empty) when
 * the profile has none, and included when it does.
 */
describe("personJsonLd", () => {
  it("has the Person shape with only the required fields when optional data is absent", () => {
    const person = personJsonLd({
      name: "Riley",
      url: `${SITE.url}/riley`,
    });
    expect(person["@context"]).toBe("https://schema.org");
    expect(person["@type"]).toBe("Person");
    expect(person.name).toBe("Riley");
    expect(person.url).toBe(`${SITE.url}/riley`);
    expect(person).not.toHaveProperty("image");
    expect(person).not.toHaveProperty("sameAs");
  });

  it("includes image and sameAs when the profile carries them", () => {
    const person = personJsonLd({
      name: "Riley",
      url: `${SITE.url}/riley`,
      image: "https://example.com/avatar.png",
      sameAs: ["https://example.com/riley"],
    });
    expect(person.image).toBe("https://example.com/avatar.png");
    expect(person.sameAs).toEqual(["https://example.com/riley"]);
  });

  it("omits sameAs when the array is empty rather than emitting an empty list", () => {
    const person = personJsonLd({
      name: "Riley",
      url: `${SITE.url}/riley`,
      sameAs: [],
    });
    expect(person).not.toHaveProperty("sameAs");
  });

  it("omits image when it is null", () => {
    const person = personJsonLd({
      name: "Riley",
      url: `${SITE.url}/riley`,
      image: null,
    });
    expect(person).not.toHaveProperty("image");
  });
});

/**
 * The ranking board ItemList schema: one ListItem per ranked player, in the
 * order given, carrying the caller's own 1-based position.
 */
describe("itemListJsonLd", () => {
  it("has the ItemList shape with one ListItem per item, in order", () => {
    const list = itemListJsonLd([
      { position: 1, url: `${SITE.url}/players/a`, name: "Player A" },
      { position: 2, url: `${SITE.url}/players/b`, name: "Player B" },
    ]);
    expect(list["@context"]).toBe("https://schema.org");
    expect(list["@type"]).toBe("ItemList");
    expect(list.itemListElement).toHaveLength(2);
    expect(list.itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      url: `${SITE.url}/players/a`,
      name: "Player A",
    });
    expect(list.itemListElement[1].position).toBe(2);
  });

  it("returns an empty itemListElement for an empty board", () => {
    const list = itemListJsonLd([]);
    expect(list.itemListElement).toEqual([]);
  });
});

/**
 * The tool/game WebApplication schema: fixed free offer, no aggregateRating,
 * and a URL resolved absolute against SITE.url whether the caller passes a
 * path or an already-absolute URL.
 */
describe("webApplicationJsonLd", () => {
  it("has the WebApplication shape with a fixed free offer and no aggregateRating", () => {
    const app = webApplicationJsonLd({
      name: "FAAB Calculator",
      description: "What to bid, and when to walk away.",
      url: "/tools/faab",
      category: "SportsApplication",
    });
    expect(app["@context"]).toBe("https://schema.org");
    expect(app["@type"]).toBe("WebApplication");
    expect(app.name).toBe("FAAB Calculator");
    expect(app.description).toBe("What to bid, and when to walk away.");
    expect(app.applicationCategory).toBe("SportsApplication");
    expect(app.operatingSystem).toBe("Any");
    expect(app.offers).toEqual({
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    });
    expect(app).not.toHaveProperty("aggregateRating");
  });

  it("resolves a path absolute against SITE.url", () => {
    const app = webApplicationJsonLd({
      name: "Signal Scout",
      description: "Guess the hidden player.",
      url: "/games/signal-scout",
      category: "GameApplication",
    });
    expect(app.url).toBe(`${SITE.url}/games/signal-scout`);
  });

  it("leaves an already-absolute url untouched", () => {
    const app = webApplicationJsonLd({
      name: "Signal Scout",
      description: "Guess the hidden player.",
      url: `${SITE.url}/games/signal-scout`,
      category: "GameApplication",
    });
    expect(app.url).toBe(`${SITE.url}/games/signal-scout`);
  });

  it("omits dateModified when not passed, includes it when it is", () => {
    const withoutDate = webApplicationJsonLd({
      name: "FAAB Calculator",
      description: "What to bid, and when to walk away.",
      url: "/tools/faab",
      category: "SportsApplication",
    });
    expect(withoutDate).not.toHaveProperty("dateModified");

    const withDate = webApplicationJsonLd({
      name: "FAAB Calculator",
      description: "What to bid, and when to walk away.",
      url: "/tools/faab",
      category: "SportsApplication",
      dateModified: "2026-09-10T00:00:00.000Z",
    });
    expect(withDate.dateModified).toBe("2026-09-10T00:00:00.000Z");
  });
});

describe("serializeJsonLd", () => {
  it("escapes script-breakout characters inside string values", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script\\u003e");
  });

  it("round-trips the combined Organization and WebSite array as valid JSON", () => {
    const out = serializeJsonLd([organizationJsonLd(), websiteJsonLd()]);
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]["@type"]).toBe("Organization");
    expect(parsed[1]["@type"]).toBe("WebSite");
  });
});
