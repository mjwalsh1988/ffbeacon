import { describe, expect, it } from "vitest";
import {
  buildEventKey,
  classifyEventKind,
  eventKeysOverlap,
  normalizeForEventKind,
} from "./event-key";

/**
 * These fixtures are the real posts that produced the 2026-08-04 to 2026-08-07
 * duplicate articles, copied verbatim from news_ingestions.text and
 * ai_result.suggested_slug. That is the point: the event key exists to group exactly
 * these, so the test has to run on exactly these rather than on tidy invented
 * sentences that would pass no matter what the keyword lists said.
 *
 * The property under test is AGREEMENT, not correctness. Whether Aaron Donald working
 * out for the Rams is best labelled a transaction is arguable. Whether both posts
 * about it land on the same label is not: if they disagree, two articles publish.
 */

const JT = "b42806b0";
const GIBBS = "50a1a85f";
const BIJAN = "7f32aec4";
const SKORONSKI = "d1e53a1c";
const WALKER = "9e66338c";
const DIGGS = "fd340eaa";
const WRIGHT = "b84226ed";
const TORRENCE = "e25a9397";
const FLOWERS = "d9221fc3";
const DONALD = "ca94db13";
const LAMAR = "f89fd45f";
const DANIEL_JONES = "760e4010";
const PIERCE = "292e6f75";

interface Fixture {
  label: string;
  text: string;
  slug: string;
  players: string[];
}

const key = (f: Fixture) =>
  buildEventKey(classifyEventKind([f.text, f.slug]), f.players);

describe("normalizeForEventKind", () => {
  it("pads and collapses so terms match whole tokens only", () => {
    expect(normalizeForEventKind("Placed on IR today")).toBe(
      " placed on ir today ",
    );
    expect(normalizeForEventKind("#Falcons' edge  rusher")).toBe(
      " falcons edge rusher ",
    );
  });

  it("does not let a short term match inside a longer word", () => {
    // "ir" inside "first" and "their" is the reason terms are space-padded.
    expect(
      classifyEventKind(["He took first team reps with their offense"]),
    ).toBe("usage");
  });
});

describe("classifyEventKind", () => {
  it("reads the kind off the classifier slug when the post text carries no event", () => {
    // This post is a bare stat line. Without the suggested slug it is unclassifiable,
    // and it published as the third Jonathan Taylor contract article.
    expect(
      classifyEventKind([
        "Jonathan Taylor over the last two seasons:\n\n626 carries\n3,026 rushing yards\n32 total TDs",
        "jonathan-taylor-colts-extension",
      ]),
    ).toBe("transaction");
  });

  it("prefers injury over the broader kinds when both appear", () => {
    expect(
      classifyEventKind([
        "Colts sign Pharaoh Brown, place Sean McKeon on IR",
        "colts-sign-pharaoh-brown-mckeon-ir",
      ]),
    ).toBe("injury");
  });

  it("returns unknown rather than guessing on text with no event signal", () => {
    expect(classifyEventKind(["Happy birthday to a legend"])).toBe("unknown");
    expect(classifyEventKind([""])).toBe("unknown");
    expect(classifyEventKind([null, undefined])).toBe("unknown");
  });
});

describe("buildEventKey", () => {
  it("refuses a key with no resolved players", () => {
    expect(buildEventKey("transaction", [])).toBeNull();
  });

  it("refuses a key on an unknown kind", () => {
    expect(buildEventKey("unknown", [JT])).toBeNull();
  });

  it("sorts and de-duplicates ids so order never changes the key", () => {
    expect(buildEventKey("transaction", [GIBBS, BIJAN, JT])).toBe(
      buildEventKey("transaction", [JT, GIBBS, BIJAN, GIBBS]),
    );
  });
});

/**
 * One describe per real duplicate cluster. Each asserts which posts collapse for free
 * (identical key) and which are handed to the model as overlap candidates.
 */
describe("the 2026-08 duplicate clusters", () => {
  it("groups the four single-subject Jonathan Taylor contract posts", () => {
    const posts: Fixture[] = [
      {
        label: "agreement reported",
        text: "Another big running back deal: three-time Pro-Bowl RB Jonathan Taylor and the Colts reached agreement today on a two-year, $44 million extension worth up to $47 million that includes $39 million guaranteed, per @rapsheet and me.",
        slug: "jonathan-taylor-colts-extension-a38a2",
        players: [JT],
      },
      {
        label: "stat line riding the news",
        text: "Jonathan Taylor over the last two seasons:\n\n626 carries\n3,026 rushing yards\n32 total TDs https://t.co/9p4NuUkv6U",
        slug: "jonathan-taylor-colts-extension",
        players: [JT],
      },
      {
        label: "beat writer follow-up",
        text: "More about Colts Pro-Bowl RB Jonathan Taylor agreeing to 2-year, $44 million extension, via @HolderStephen:",
        slug: "jonathan-taylor-colts-extension-details",
        players: [JT],
      },
      {
        label: "officially signed",
        text: "Jonathan Taylor officially has signed his two-year extension.",
        slug: "jonathan-taylor-signs-two-year-extension",
        players: [JT],
      },
    ];
    const keys = posts.map(key);
    expect(keys[0]).toBe(`transaction:${JT}`);
    expect(new Set(keys).size).toBe(1);
  });

  it("offers the multi-player Colts posts as overlap candidates, not exact matches", () => {
    const solo = buildEventKey("transaction", [JT]);
    const trio = key({
      label: "QB/RB/WR trio",
      text: "The Colts have now handed out major contracts to their QB/RB/WR trio this offseason:\n\nDaniel Jones: 2 years, $88M\nJonathan Taylor: 2 years, $44M\nAlec Pierce: 4 years, $114M",
      slug: "colts-major-contracts-jones-taylor-pierce",
      players: [DANIEL_JONES, JT, PIERCE],
    });
    expect(trio).not.toBe(solo);
    expect(eventKeysOverlap(trio, solo)).toBe(true);
  });

  it("groups the three single-subject Jahmyr Gibbs contract posts", () => {
    const posts: Fixture[] = [
      {
        label: "agreement reported",
        text: "Last but hardly least: Three-time Pro-Bowl selection Jahmyr Gibbs and the Lions reached agreement today on a three-year, $67.5 million deal that could be worth up to $75.75 million and includes $51.5 million guaranteed, now making him the NFL's highest-paid running back.",
        slug: "jahmyr-gibbs-record-rb-contract-lions",
        players: [GIBBS],
      },
      {
        label: "beat writer follow-up",
        text: "More about the Lions making Jahmyr Gibbs' the NFL's newest highest-paid running back, via @E_Woodyard:",
        slug: "jahmyr-gibbs-record-extension-lions",
        players: [GIBBS],
      },
      {
        label: "officially signed, next day",
        text: "Lions RB Jahmyr Gibbs officially signed his three-year extension.",
        slug: "jahmyr-gibbs-signs-extension-lions",
        players: [GIBBS],
      },
    ];
    expect(new Set(posts.map(key)).size).toBe(1);
    expect(posts.map(key)[0]).toBe(`transaction:${GIBBS}`);
  });

  it("groups all five Jalon Walker ACL posts, including the one with no text", () => {
    const posts: Fixture[] = [
      {
        // The post text is a bare quote-tweet stub. Only the classifier slug says
        // what it is about.
        label: "quote-tweet stub",
        text: "Worst part of training camp: https://t.co/k9eDrJT0TH",
        slug: "falcons-jalon-walker-injury-training-camp",
        players: [WALKER],
      },
      {
        label: "feared torn",
        text: "#Falcons promising edge Jalon Walker is feared to have torn his ACL, per me and @wyche89, a potential brutal injury for this defense.",
        slug: "falcons-jalon-walker-torn-acl-injury",
        players: [WALKER],
      },
      {
        label: "beat writer follow-up",
        text: "More about Falcons edge rusher Jalon Walker being feared to have torn his ACL:",
        slug: "falcons-jalon-walker-torn-acl",
        players: [WALKER],
      },
      {
        label: "tests confirm",
        text: "Source: Tests confirmed an ACL tear for Falcons' Jalon Walker.",
        slug: "falcons-jalon-walker-acl-tear",
        players: [WALKER],
      },
      {
        label: "out for the season",
        text: "The Falcons now have confirmed that Jalon Walker will miss the 2026 season due to the torn ACL he suffered Tuesday.",
        slug: "falcons-jalon-walker-torn-acl-out-2026-season",
        players: [WALKER],
      },
    ];
    expect(new Set(posts.map(key)).size).toBe(1);
    expect(posts.map(key)[0]).toBe(`injury:${WALKER}`);
  });

  it("groups the Stefon Diggs signing across 'expected to sign' and 'officially signed'", () => {
    const reported = key({
      label: "set to sign",
      text: "More about the Washington Commanders being set to sign free-agent WR Stefon Diggs, via @john_keim:",
      slug: "commanders-sign-stefon-diggs",
      players: [DIGGS],
    });
    const official = key({
      label: "officially signed",
      text: "Wide receiver Stefon Diggs officially signed this morning with the Commanders.",
      slug: "stefon-diggs-signs-commanders",
      players: [DIGGS],
    });
    expect(reported).toBe(official);
    expect(reported).toBe(`transaction:${DIGGS}`);
  });

  it("groups both Peter Skoronski posts, which published two minutes apart", () => {
    const a = key({
      label: "agreed to terms",
      text: "Sources: The #Titans and standout G Peter Skoronski have agreed to terms on a huge new extension to make him the highest-paid guard in the NFL.",
      slug: "titans-peter-skoronski-extension-highest-paid-guard",
      players: [SKORONSKI],
    });
    const b = key({
      label: "staying in Nashville",
      text: "Skoronski staying in Nashville with multi-year contract extension https://t.co/sKiGFHT4uG",
      slug: "peter-skoronski-extension-titans",
      players: [SKORONSKI],
    });
    expect(a).toBe(b);
  });

  it("groups all three Darnell Wright posts", () => {
    const posts: Fixture[] = [
      {
        label: "agreed to terms",
        text: "The #Bears and All-Pro OT Darnell Wright have agreed to terms on a fat new deal to make him one of the NFL's highest paid, per me and @JFowlerESPN.",
        slug: "bears-darnell-wright-contract-extension-116-million",
        players: [WRIGHT],
      },
      {
        label: "beat writer follow-up",
        text: "More about the Chicago Bears and right tackle Darnell Wright reaching agreement Tuesday on a historic four-year, $116 million extension that includes $93M guaranteed:",
        slug: "darnell-wright-extension-bears",
        players: [WRIGHT],
      },
      {
        label: "officially signed",
        text: "Bears announced they now officially have signed offensive lineman Darnell Wright to a four-year extension through 2031.",
        slug: "bears-darnell-wright-extension-2031",
        players: [WRIGHT],
      },
    ];
    expect(new Set(posts.map(key)).size).toBe(1);
  });

  it("groups both O'Cyrus Torrence posts", () => {
    const a = key({
      label: "agreement",
      text: "Bills reached agreement with G O'Cyrus Torrence on a four-year, $78.4 million extension that includes $46 million guaranteed, making him the NFL's 7th-highest paid guard.",
      slug: "bills-extend-ocyrus-torrence-four-year-extension",
      players: [TORRENCE],
    });
    const b = key({
      label: "beat writer follow-up",
      text: "More about the Buffalo Bills reaching an agreement with right guard O'Cyrus Torrence on a four-year, $78.4 million extension that includes $46 million guaranteed, via @agetzenberg:",
      slug: "bills-ocyrus-torrence-extension-78-million",
      players: [TORRENCE],
    });
    expect(a).toBe(b);
  });

  it("groups both Aaron Donald workout posts", () => {
    const a = key({
      label: "worked out",
      text: "Aaron Donald worked out today for the Los Angeles Rams, per the NFL wire.",
      slug: "aaron-donald-workout-rams",
      players: [DONALD],
    });
    const b = key({
      label: "helmet detail",
      text: "Aaron Donald wanted to do a workout in a football helmet, and even though he did not wear pads during it, he used Rams' team equipment at their facility during training camp, requiring them to report his activity to the NFL.",
      slug: "aaron-donald-workout-rams-training-camp",
      players: [DONALD],
    });
    expect(a).toBe(b);
    // "training camp" would read as usage on its own; the workout wins because
    // transaction is checked first, and both posts agree, which is what matters.
    expect(a).toBe(`transaction:${DONALD}`);
  });

  it("groups the two Bijan Robinson contract posts a day apart", () => {
    const deal = key({
      label: "deal reported",
      text: "ESPN sources: Two-time Pro-Bowl selection Bijan Robinson and the Falcons reached agreement on a three-year extension worth up to $75 million that now will make him the highest-paid running back in NFL history.",
      slug: "bijan-robinson-contract-extension-falcons",
      players: [BIJAN],
    });
    const reaction = key({
      label: "McConaughey reaction",
      text: ".@McConaughey texted @Bijan5Robinson as soon as his contract news hit this week",
      slug: "mcconaughey-texts-bijan-robinson-contract-extension",
      players: [BIJAN],
    });
    expect(deal).toBe(reaction);
  });

  it("groups the two running-back market roundups, which are one story", () => {
    const first = key({
      label: "paves the way",
      text: "Bijan Robinson's new deal now could help pave the way for deals for Lions RB Jahmyr Gibbs and Colts RB Jonathan Taylor.",
      slug: "gibbs-taylor-contracts-robinson-extension",
      players: [BIJAN, GIBBS, JT],
    });
    const second = key({
      label: "three at $20M",
      text: "There was only one $20 million-per-year running back entering this offseason.\n\nThe NFL now has seen three players enter that category this week alone: Jahmyr Gibbs, Bijan Robinson, and Jonathan Taylor.",
      slug: "gibbs-robinson-taylor-20m-running-back-deals",
      players: [GIBBS, BIJAN, JT],
    });
    expect(first).toBe(second);
  });

  it("treats the Zay Flowers reaction post as an overlap, not an exact match", () => {
    const deal = buildEventKey("transaction", [FLOWERS]);
    const reaction = key({
      label: "Flowers on Lamar",
      text: "After signing his four-year extension, Pro Bowl wide receiver Zay Flowers said he hopes quarterback Lamar Jackson is with the Baltimore Ravens equally as long.",
      slug: "zay-flowers-four-year-extension-ravens",
      players: [FLOWERS, LAMAR],
    });
    expect(reaction).not.toBe(deal);
    expect(eventKeysOverlap(reaction, deal)).toBe(true);
  });
});

describe("eventKeysOverlap", () => {
  it("is false across different kinds even for the same player", () => {
    // A contract and an injury for one player are two stories. This is the check
    // that stops the pre-0169 failure where anything sharing a name got merged.
    expect(eventKeysOverlap(`transaction:${GIBBS}`, `injury:${GIBBS}`)).toBe(
      false,
    );
  });

  it("is false when the player sets are disjoint", () => {
    expect(
      eventKeysOverlap(`transaction:${GIBBS}`, `transaction:${BIJAN}`),
    ).toBe(false);
  });

  it("is false when either key is missing", () => {
    expect(eventKeysOverlap(null, `transaction:${GIBBS}`)).toBe(false);
    expect(eventKeysOverlap(`transaction:${GIBBS}`, undefined)).toBe(false);
  });
});
