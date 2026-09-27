-- The RELAY section of the classify prompt now lives in ONE place:
-- bd_relay_extract_prompt, the "Relay extraction prompt section" field on the
-- Brief desk settings page.
--
-- Migration 0285 seeded that setting AND appended the same section to
-- bb_categorize_prompt, and lib/relays/extract.ts withRelaySection used the
-- setting only when the categorize prompt had lost the marker line. It never
-- had, so an edit to the field changed nothing the model read. The code now
-- always sends the setting's copy (and cuts any section it finds in the
-- categorize prompt); this removes the stored second copy so the categorize
-- field shows only what it controls.
--
-- Safe in either deploy order: before the new code ships, the old code finds no
-- marker and appends the setting, which 0314 left identical to the copy removed
-- here. The section was only ever appended, so cutting from the marker line to
-- the end removes exactly it (verified before applying: that tail equals the
-- setting's text byte for byte).
--
-- Data only. Access matrix unchanged: beacon_settings is service_role only; the
-- admin pages read and write it through the service-role client behind
-- requireAdmin.

update beacon_settings
set value = to_jsonb(regexp_replace(
      left(value #>> '{}', position('== RELAY ==' in value #>> '{}') - 1),
      '\s+$', ''
    )),
    updated_at = now()
where key = 'bb_categorize_prompt'
  and position('== RELAY ==' in value #>> '{}') > 0;

update beacon_settings
set description = $dsc$The RELAY section of the classify prompt, and the only copy the model reads: it is sent after the categorize prompt on every post. An edit here reaches the next post within a minute.$dsc$,
    updated_at = now()
where key = 'bd_relay_extract_prompt';
