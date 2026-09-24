import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The defender branch of the player page (plan IDP-203).
 *
 * Source-level, in the og/faab route.test.ts style: the page reads Supabase,
 * and the property under test is which component each branch renders, which
 * the source states exactly. The loaders and components under the branch have
 * their own tests.
 */
const page = readFileSync(join(process.cwd(), "app/players/[slug]/page.tsx"), "utf8");

describe("player page, defender branch", () => {
  it("decides the branch once per render path (metadata and page)", () => {
    expect(page.match(/isDefender\(/g)?.length).toBe(2);
  });

  it("renders the defender tabs only behind the flag, the offensive ones only without it", () => {
    expect(page).toContain('defender && activeTab === "overview" && (');
    expect(page).toContain('defender && activeTab === "statistics" && <DefenderStatsTab');
    expect(page).toContain('!defender && activeTab === "overview" && (');
    expect(page).toContain('!defender && activeTab === "statistics" && (');
  });

  it("passes the hero variant only inside the defender branch", () => {
    expect(page).toContain('{...(defender ? { variant: "defender" as const } : {})}');
    expect(page.match(/variant: "defender"/g)?.length).toBe(1);
  });

  it("gives a defender an honest title, a noindex outside the gate, and no value banner", () => {
    expect(page).toContain("IDP Stats, Snap Share and News");
    expect(page).toContain("robots: { index: false, follow: true }");
    expect(page).toContain("!defender && context.fallbackBanner");
    // The defender description never promises trade value.
    const defenderDescription = page.slice(
      page.indexOf("IDP profile:"),
      page.indexOf("IDP profile:") + 120,
    );
    expect(defenderDescription).not.toMatch(/trade value/i);
  });

  it("names the middle breadcrumb without a URL for a defender", () => {
    expect(page).toContain('{ "@type": "ListItem", position: 2, name: "Players" }');
  });
});
