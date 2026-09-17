/**
 * Print the SQL that seeds the brief_desk settings rows, from the code seeds.
 *
 * Migration 0285 was generated with this so the prompt text stored in the
 * database is byte-identical to the fallbacks in lib/brief-desk/settings.ts and
 * lib/relays/extract.ts. Re-run it after editing either seed and diff the
 * output against the migration; do not edit the migration's prompt text by hand.
 *
 *   npx tsx scripts/gen-brief-desk-settings-sql.ts > out.sql
 */

import { BRIEF_INSTRUCTIONS_SEED } from "../lib/brief-desk/instructions-seed";
import { RELAY_PROMPT_MARKER, RELAY_PROMPT_SECTION } from "../lib/relays/extract";
import { RELAY_HEADLINE_MAX } from "../lib/relays/types";

/** A dollar-quoted literal that cannot be broken by anything in the text. */
function dq(tag: string, text: string): string {
  return `$${tag}$${text}$${tag}$`;
}

const rows: Array<[key: string, value: string, type: string, label: string, description: string]> = [
  ["bd_enabled", "true", "boolean", "Brief desk enabled", "The bundle endpoint answers due at all. Off means every desk run is told no edition is due."],
  ["bd_inseason_cadence", "to_jsonb('weekly'::text)", "string", "In-season cadence", "Fixed at weekly. Shown for clarity; the period is the NFL week."],
  ["bd_offseason_monthly", "false", "boolean", "Off-season monthly", "Off, the off-season runs every two weeks with periods closing on the 1st and 16th. On, periods close on the 1st only."],
  ["bd_run_weekday", "2", "number", "Close weekday", "The weekday an in-season period closes, Eastern. 0 is Sunday, 2 is Tuesday."],
  ["bd_run_hour_et", "9", "number", "Close hour (Eastern)", "The hour the period closes, Eastern. 9 is 9 AM, after Monday night has settled and the box scores have synced."],
  ["bd_min_relays", "6", "number", "Minimum relays (off-season)", "Off-season only: below this many relays the period is not due and rolls into the next one. In season every week is due, however quiet."],
  ["bd_discord_briefs_enabled", "true", "boolean", "Post approved Briefs to Discord", "When on, approving an edition posts it to the Beacon Brief webhook with an everyone mention and the link. The approve form still carries a per-edition checkbox."],
  ["bd_relay_headline_max", String(RELAY_HEADLINE_MAX), "number", "Relay headline maximum", "Longest headline a Relay may carry, enforced in code and stated in the prompt."],
  ["bd_brief_instructions", `to_jsonb(${dq("seed", BRIEF_INSTRUCTIONS_SEED)}::text)`, "string", "Editorial instructions for the desk run", "The editorial brief returned inside the bundle. The desk run follows it exactly, so every editorial change is an edit here rather than a deploy."],
  ["bd_relay_extract_prompt", `to_jsonb(${dq("seed", RELAY_PROMPT_SECTION)}::text)`, "string", "Relay extraction prompt section", "The RELAY section of the classify prompt. It is appended to bb_categorize_prompt when that prompt does not already contain the marker line."],
];

const values = rows
  .map(
    ([key, value, type, label, description]) =>
      `  ('brief_desk', '${key}', ${value.startsWith("to_jsonb") ? value : `'${value}'::jsonb`}, '${type}', ${dq("lbl", label)}, ${dq("dsc", description)})`,
  )
  .join(",\n");

const sql = `insert into public.beacon_settings (category, key, value, value_type, label, description) values
${values}
on conflict (key) do nothing;

insert into public.beacon_settings (category, key, value, value_type, label, description) values
  ('beacon_brief', 'bb_article_write_enabled', 'false'::jsonb, 'boolean', 'Legacy article writing', 'Legacy. When on, a post that clears the context threshold still enqueues the old per-post article. Off since the Relay pipeline landed (migration 0285); the worker keeps the handler so this can be turned back on without a deploy.')
on conflict (key) do nothing;

update public.beacon_settings
set value = to_jsonb((value #>> '{}') || E'\\n\\n' || ${dq("seed", RELAY_PROMPT_SECTION)}::text),
    updated_at = now()
where category = 'beacon_brief'
  and key = 'bb_categorize_prompt'
  and value #>> '{}' not like '%${RELAY_PROMPT_MARKER}%';
`;

process.stdout.write(sql);
