/**
 * The `relay` half of the classify call: the JSON schema fragment the model
 * must satisfy, the prompt section that describes it, and the normaliser that
 * turns the model's object into a RelayExtraction the rest of the pipeline can
 * trust.
 *
 * The prompt is the request. lib/relays/grounding.ts is the guarantee: a
 * number, a name or a team that the post does not contain fails the check no
 * matter what the prompt said. Both exist because the failure this is built
 * against is the quiet one, a model correcting a post from memory, and a
 * prompt alone cannot be audited after the fact.
 *
 * The section text below is the SEED for the bd_relay_extract_prompt setting
 * (migration 0285). The live copy is the database row, editable on the admin
 * settings page; this constant is the fallback when the row is missing.
 */

import {
  RELAY_FACT_LABEL_MAX,
  RELAY_FACT_VALUE_MAX,
  RELAY_HEADLINE_MAX,
  RELAY_HEADLINE_MIN,
  RELAY_MAX_FACTS,
  RELAY_AVAILABILITIES,
  RELAY_KINDS,
  isRelayAvailability,
  isRelayKind,
  type RelayExtraction,
  type RelayFact,
} from "./types";

/** The marker the migration and the runtime both look for, so the section is
 * appended to the categorize prompt exactly once. */
export const RELAY_PROMPT_MARKER = "== RELAY ==";

/**
 * JSON schema for the `relay` property on the classify call. Merged into
 * CATEGORIZE_SCHEMA in lib/beacon-brief/curate.ts. Strict: no extra keys, every
 * field required, enums pinned to the code's own lists.
 */
export const RELAY_SCHEMA_FRAGMENT = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "kind", "facts", "timeline", "availability"],
  properties: {
    headline: { type: "string" },
    kind: { type: "string", enum: [...RELAY_KINDS] },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
        },
      },
    },
    timeline: { type: ["string", "null"] },
    availability: { type: "string", enum: [...RELAY_AVAILABILITIES] },
  },
} as const;

/** The prompt section, seeded into beacon_settings and appended to the classify prompt. */
export const RELAY_PROMPT_SECTION = `${RELAY_PROMPT_MARKER}
Return a relay object built ONLY from the text of this post.

THE POST IS THE ONLY SOURCE. You have no other. The post is newer than everything you remember, and it comes from a reporter FF Beacon has chosen to trust. Every team, position, contract figure, injury, timeline, coach and roster fact in your output must appear in the post. If the post says a player is on a team you believe he left, he is on that team. If the post gives a timeline you believe is wrong, that is the timeline. If the post names a position you believe is wrong, that is the position. You are not being asked whether the post is true. You are being asked what it says.

NEVER ADD. Do not add a team, position, age, contract year, injury type, return date or any other detail the post does not state, even when you are sure of it. A fact the post leaves out is left out. A timeline the post does not give is null, never a typical timeline for that injury. If a post names a player without a team, the headline names the player without a team.

NEVER CORRECT. Do not fix what looks like a typo in a name, a number or a team. Copy it. A wrong figure copied from a post is the reporter's error and is handled by the deletion watch; a right figure changed by you is our error and nobody can find it.

headline: 40 to 220 characters. One or two sentences stating what happened, naming the player or team as the post names them. No opinion, no consequence, no "reports" or "sources say" (the card credits the source underneath), no hashtags, no quotation of the reporter.

kind: one of injury, transaction, contract, suspension, depth_chart, coaching, performance, draft, legal, other.

facts: 0 to 6 items of { label, value }. Label at most 24 characters, value at most 80. Each value is a phrase lifted from the post, in the post's own words and numbers. Typical labels: Injury, Timeline, Status, Contract, Guaranteed, Traded for, Signed with, Released by, Suspended for, Also.

timeline: the availability window in the post's own words, or null.

availability: one of out, doubtful, questionable, active, ir, pup, released, signed, traded, suspended, waived, none. Choose none unless the post states the status.

When a post covers more than one player, the headline names the primary subject and facts may name the others under the label Also.

Plain ASCII punctuation only. No dashes as separators, no ellipsis character, no curly quotes, no emoji.`;

/**
 * Append the relay section to a classify prompt that does not already carry it.
 * The migration writes the section into the stored prompt; this covers a prompt
 * an admin has since edited it back out of, or a fresh install with no row.
 */
export function withRelaySection(categorizePrompt: string, section: string): string {
  if (categorizePrompt.includes(RELAY_PROMPT_MARKER)) return categorizePrompt;
  const trimmed = categorizePrompt.trimEnd();
  return trimmed ? `${trimmed}\n\n${section}` : section;
}

/** Collapse whitespace and strip the characters the prompt forbids. */
function cleanText(value: string): string {
  return value
    .replace(/[\u2013\u2014]/g, ", ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn the model's `relay` object into a RelayExtraction, or null when it is
 * missing or unusable. Lengths are clamped rather than rejected: a headline two
 * characters over the prompt's limit is still the post's headline, and the
 * grounding check, not the length, decides whether it is safe to publish.
 */
export function normalizeRelayExtraction(raw: unknown): RelayExtraction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const headline = typeof r.headline === "string" ? cleanText(r.headline) : "";
  if (headline.length < RELAY_HEADLINE_MIN) return null;

  const kind = isRelayKind(r.kind) ? r.kind : "other";
  const availability = isRelayAvailability(r.availability) ? r.availability : "none";
  const timeline =
    typeof r.timeline === "string" && r.timeline.trim() ? cleanText(r.timeline) : null;

  const facts: RelayFact[] = [];
  if (Array.isArray(r.facts)) {
    for (const entry of r.facts) {
      if (!entry || typeof entry !== "object") continue;
      const label = (entry as { label?: unknown }).label;
      const value = (entry as { value?: unknown }).value;
      if (typeof label !== "string" || typeof value !== "string") continue;
      const cleanLabel = cleanText(label).slice(0, RELAY_FACT_LABEL_MAX);
      const cleanValue = cleanText(value).slice(0, RELAY_FACT_VALUE_MAX);
      if (!cleanLabel || !cleanValue) continue;
      facts.push({ label: cleanLabel, value: cleanValue });
      if (facts.length >= RELAY_MAX_FACTS) break;
    }
  }

  return {
    headline: headline.slice(0, RELAY_HEADLINE_MAX),
    kind,
    facts,
    timeline,
    availability,
  };
}
