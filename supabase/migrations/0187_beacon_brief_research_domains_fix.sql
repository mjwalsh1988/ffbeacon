-- Migration 0187: fix the research domain list shipped in 0186
--
-- 0186 seeded bb_research_domains with 22 outlets. Seven of them cannot be
-- crawled by Anthropic's search agent, and the API does not skip a blocked entry
-- or warn about it. It rejects the ENTIRE request with a 400 naming them:
--
--   "The following domains are not accessible to our user agent:
--    ['apnews.com', 'nypost.com', 'nytimes.com', 'reuters.com',
--     'sportingnews.com', 'theathletic.com', 'usatoday.com']"
--
-- So every research call failed. Verified against the live API before and after
-- this fix, on both claude-haiku-4-5 and claude-sonnet-4-6.
--
-- The failure mode is the reason this needed its own migration rather than a
-- quiet edit. runWebSearchResearch catches the error and returns null, the
-- writer treats the article as one with nothing to research, and articles keep
-- publishing. Research spend goes to zero. On a cost dashboard that is
-- indistinguishable from the 0186 saving working perfectly, which is exactly
-- what 0186 predicted, so nothing would have looked wrong.
--
-- Two defences ship alongside this row change, in lib/beacon-brief/ai.ts:
--   1. A rejected domain list is now retried once with no domain restriction,
--      and logs a warning naming the bad entries. Searching more widely than
--      intended beats losing research entirely and not being told.
--   2. allowed_callers is pinned to ["direct"]. Its default routes the search
--      through dynamic filtering, which Haiku 4.5 cannot use at all (a separate
--      400), and which measured about 47k input tokens per search against about
--      14k going direct. Pinning it fixes the model error and lowers the bill.
--
-- The 15 kept below are the ones the API accepted. The 7 removed are not
-- editorial judgements about quality; they are simply unreachable, and putting
-- any of them back breaks every research call again.
--
-- Access matrix: unchanged. beacon_settings stays service_role-write behind the
-- admin gate.

update public.beacon_settings
set value = to_jsonb($domains$espn.com, nfl.com, nbcsports.com, cbssports.com, foxsports.com, si.com, sports.yahoo.com, bleacherreport.com, profootballnetwork.com, pff.com, rotowire.com, fantasypros.com, spotrac.com, overthecap.com, athlonsports.com$domains$::text),
    description = 'Comma-separated list of domains the research call may search. Subdomains are included automatically, so nbcsports.com covers profootballtalk.nbcsports.com. Clear the field to search the whole web. IMPORTANT: every domain must be one Anthropic''s search agent can actually crawl. A single unreachable entry makes the API reject the whole request, and the pipeline then falls back to an unrestricted search and logs a warning on the Logs page. These are known to be blocked and must not be added back: apnews.com, reuters.com, nytimes.com, nypost.com, usatoday.com, theathletic.com, sportingnews.com. The trade-off of any list is local beat coverage: a story broken by a team beat writer will not be found unless that paper is listed.',
    updated_at = now()
where key = 'bb_research_domains';

-- The gate's character floor is the one fail-safe the model can never override,
-- so a negative or fractional value quietly disables it. Nothing validated the
-- range: updateBeaconSetting only checks Number.isFinite. A CHECK on the row
-- makes a bad value fail loudly at save time instead of silently widening the
-- blast radius of every other gate decision.
alter table public.beacon_settings
  drop constraint if exists beacon_settings_gate_floor_nonneg;

alter table public.beacon_settings
  add constraint beacon_settings_gate_floor_nonneg check (
    key <> 'bb_research_gate_min_post_chars'
    or (
      jsonb_typeof(value) = 'number'
      and (value #>> '{}')::numeric >= 0
      and (value #>> '{}')::numeric = floor((value #>> '{}')::numeric)
    )
  );
