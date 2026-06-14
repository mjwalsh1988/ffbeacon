-- 0055_beacon_settings_plain_language_descriptions.sql
--
-- Rewrites every beacon_settings.description into plain, non-developer language so
-- the admin Settings page explains EXACTLY how each knob moves FF Beacon values.
-- No schema change: this only updates the human-facing description text. RLS and
-- policies are unchanged from 0037_beacon_settings.sql (public SELECT, writes via
-- service role only), so no policy block is needed here.
--
-- Access matrix (unchanged): beacon_settings = public SELECT, service-role writes.

-- factor: the final guardrail on how far signals can move a value off the blend.
update beacon_settings set description =
  'The most the performance and AI signals can push a player ABOVE their blended market value. 1.5 means a value can rise to at most 150 percent of the blend, no matter how strong the signals are. Raise it to let signals push values higher; lower it to keep values closer to the raw market blend.'
  where key = 'factor_max';

update beacon_settings set description =
  'The most the performance and AI signals can pull a player BELOW their blended market value. 0.5 means a value can drop to at most 50 percent of the blend. Raise it (toward 1.0) to limit how far signals can mark a player down; lower it to allow bigger cuts.'
  where key = 'factor_min';

-- staleness: when a source has gone quiet, stop trusting it.
update beacon_settings set description =
  'For a source we expect to refresh every day (for example KTC), if its newest snapshot is older than this many days we drop it from the blend until it updates again. Lower it to stop trusting stale daily sources sooner; raise it to keep using them longer.'
  where key = 'stale_after_days_daily';

update beacon_settings set description =
  'The same staleness cutoff, but for any source whose update schedule we do not recognise. This is the safety fallback so an unknown source can never sit in the blend forever.'
  where key = 'stale_after_days_default';

update beacon_settings set description =
  'For a source we expect to refresh weekly, if its newest snapshot is older than this many days we drop it from the blend. Weekly sources get a longer leash than daily ones because they are expected to update less often.'
  where key = 'stale_after_days_weekly';

-- normalization: put every source on one common scale before averaging.
update beacon_settings set description =
  'Lining sources up by rank needs enough players to be reliable. If a single position and format group has fewer players than this, that source falls back to a simpler stretch method and is flagged low-confidence for that group. Raise it to demand more data before trusting the precise method; lower it to use the precise method on smaller groups.'
  where key = 'min_players_for_quantile';

update beacon_settings set description =
  'How each source''s raw numbers get rescaled onto FF Beacon''s common 0 to 10000 curve before they are blended. quantile_median lines sources up by rank (the top-percentile player on one source maps to the same spot on ours), which is the accurate default. p99_scale is a simpler stretch that just divides by a near-top value, used as the fallback when data is thin.'
  where key = 'normalization_method';

-- derivation: the tight-end-premium boost for the dynasty-ppr-tep format.
update beacon_settings set description =
  'A tight end needs at least this many base fantasy points in a season before any tight-end-premium boost is applied. Below this there is too little signal to trust, so the TE gets no boost. Raise it to boost only proven TEs; lower it to also boost fringe TEs.'
  where key = 'tep_min_base_pts';

update beacon_settings set description =
  'The biggest boost any single tight end can receive in the tight-end-premium format, as a share of their value. 0.2 means at most a 20 percent bump, even for an elite TE. Raise it to let top TEs gain more in that format; lower it to keep the format closer to standard scoring.'
  where key = 'tep_value_cap';

update beacon_settings set description =
  'How strongly a tight end''s extra tight-end-premium scoring converts into a value boost. Higher means the same scoring gain produces a bigger value increase (still capped by the TEP value cap); lower means a gentler boost. 0.5 is a half-strength conversion.'
  where key = 'tep_value_sensitivity';

-- ai: the optional, tightly bounded per-player nudge from the model.
update beacon_settings set description =
  'The hard limit on how far the AI can move any single player, in either direction. 0.12 means the AI can nudge a value by at most plus or minus 12 percent. The AI is told this limit and its answer is clamped to it. Raise it to give the AI more room; lower it to keep AI nudges small.'
  where key = 'ai_adjustment_bound';

update beacon_settings set description =
  'Master on/off switch for the AI signal. While Off the AI is never called and never changes any value, whatever the AI weight says. Turn it On only once you trust the non-AI values as a baseline. The AI also needs its ai_adjust weight enabled on the Signal weights page before it can move values.'
  where key = 'ai_enabled';

update beacon_settings set description =
  'Cost control. The most live AI calls allowed in one full recompute. Each call costs money, so once this many have run the remaining candidates are skipped for that run. Raise it to let the AI review more players per run (higher cost); lower it to cap spend.'
  where key = 'ai_max_calls';

update beacon_settings set description =
  'One of the two ways a player earns an AI review. If recent on-field performance has already moved a player''s value by at least this share (0.05 = 5 percent), they become an AI candidate. Higher means only sharp risers and fallers qualify; lower means more players qualify.'
  where key = 'ai_min_mover';

update beacon_settings set description =
  'The other way a player earns an AI review. When the sources disagree about a player by at least this much on the common scale, they become an AI candidate. Higher means only hotly contested players get reviewed (fewer calls); lower means more players qualify.'
  where key = 'ai_min_spread';

update beacon_settings set description =
  'Which Anthropic model runs the per-player AI nudge. A faster, cheaper model lowers cost per run; a stronger model may give better nudges at higher cost.'
  where key = 'ai_model';

update beacon_settings set description =
  'The exact instructions sent to the AI on every per-player call. This is the full template, not a summary, so you can read and edit precisely what the model is asked to do. The text {bound} is swapped for the AI adjustment bound at run time. Editing this changes the AI''s behaviour directly on the next recompute.'
  where key = 'ai_system_prompt';
