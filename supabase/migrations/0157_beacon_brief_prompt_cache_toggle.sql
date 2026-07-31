-- Migration 0157: prompt caching for the article and rewrite system prompts
--
-- runStructuredCall (lib/beacon-brief/ai.ts) now marks the system prompt for
-- prompt caching. Repeat calls inside the 5-minute window bill that prompt at
-- roughly a tenth of the input rate instead of full price.
--
-- This is a BILLING change only. The block form of the system parameter adds a
-- cache marker and nothing else, so the model receives byte-identical input and
-- cannot answer differently. There is no quality tradeoff to weigh.
--
-- Why it pays here: prompt caching is a prefix match, and these calls send no
-- tools, so the system prompt IS the whole cacheable prefix. It comes from
-- beacon_settings, so it is byte-identical on every call, and the per-call post
-- and research notes sit after it where they belong. A cache read costs about
-- 0.1x; a write costs 1.25x, so it only pays when calls cluster inside the
-- window. Measured over 30 days, the median gap between article-writing calls
-- is 12 seconds and 176 of 291 calls land within 5 minutes of the previous one.
--
-- The 5-minute TTL beats the 1-hour one here. The 1-hour TTL doubles the write
-- cost to buy 30 more cache hits (206 of 291 calls fall within an hour rather
-- than 176), which does not cover the extra writes.
--
-- Only the two Sonnet prompts qualify. Caching has a per-model minimum prompt
-- size and Haiku 4.5's is 4096 tokens, well above the categorize, triage, and
-- follow-up prompts, so those calls are left alone. The gate lives in
-- shouldCacheSystemPrompt(); below the minimum the API silently declines to
-- cache anyway, so a wrong guess costs nothing.
--
-- This toggle is the escape hatch. If article volume ever spreads out so calls
-- stop clustering, every call would pay a 1.25x write for a cache nothing
-- reads. Turning this off restores the previous behaviour with no deploy.
--
-- Access matrix: unchanged. beacon_settings stays service_role-write behind the
-- admin gate.

insert into public.beacon_settings (category, key, value, value_type, label, description)
values
  ('beacon_brief', 'bb_prompt_cache_enabled', 'true'::jsonb, 'boolean',
   'Cache long system prompts',
   'Bills a repeated system prompt at about a tenth of the input rate when calls land within 5 minutes of each other. Affects cost only: the model receives identical input either way, so output cannot change. Turn off only if article writes stop arriving in bursts, since an isolated call pays a small premium for a cache nothing reads.')
on conflict (key) do nothing;
