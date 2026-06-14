-- Migration 0052: AI signal settings into beacon_settings (category 'ai')
--
-- Access matrix: inherits beacon_settings (service_role ALL; client writes blocked).
--
-- Adds the admin-editable AI controls so EVERY prompt and cost knob is visible
-- and editable on /admin/beacon/settings. Nothing about the AI call is
-- hardcoded: the engine reads ai_system_prompt live and substitutes the {bound}
-- placeholder with ai_adjustment_bound at runtime. The code default in
-- lib/beacon/signals/ai-adjust.ts is only a fallback used when this row is
-- absent. ai_enabled / ai_model / ai_adjustment_bound already exist (0037).
--
--   ai_system_prompt : the full instruction template sent to the model.
--   ai_max_calls     : per-run cap on live API calls (cost control).
--   ai_min_spread    : candidate gate, normalized cross-source disagreement.
--   ai_min_mover     : candidate gate, abs(stat_performance adjustment).

insert into public.beacon_settings (key, value, value_type, category, label, description) values
  (
    'ai_system_prompt',
    to_jsonb('You are a conservative fantasy football analyst assisting a dynasty and redraft value engine. You receive market data for one player as JSON: the consensus value, per-source raw values, cross-source disagreement, and a recent on-field performance signal. Return a small adjustment to the market value for that player. The market already prices in most public information, so be conservative and only move a value when the inputs strongly disagree with the consensus or recent performance is a clear outlier. Respond with STRICT JSON only, no prose and no code fences, matching exactly: {"adjustment_pct": number, "confidence": number, "rationale": string}. adjustment_pct must be between -{bound} and {bound} as a fraction (for example 0.05 means plus 5 percent). confidence must be between 0 and 1. rationale must be 20 words or fewer. When in doubt, return adjustment_pct 0 with low confidence.'::text),
    'string',
    'ai',
    'AI system prompt',
    'Instructions sent to the model for every per-player adjustment call. {bound} is replaced with the AI adjustment bound at runtime. This is the exact prompt template the engine sends; edit it here to review or change what the AI receives.'
  ),
  (
    'ai_max_calls',
    '60'::jsonb,
    'number',
    'ai',
    'AI max calls per run',
    'Hard cap on live Anthropic API calls in a single value run (cost control). Candidates beyond this are skipped for the run.'
  ),
  (
    'ai_min_spread',
    '0.15'::jsonb,
    'number',
    'ai',
    'AI candidate min source spread',
    'A player becomes an AI candidate when normalized cross-source disagreement is at least this. Higher means fewer, more contested candidates.'
  ),
  (
    'ai_min_mover',
    '0.05'::jsonb,
    'number',
    'ai',
    'AI candidate min performance move',
    'A player also becomes an AI candidate when the absolute stat_performance adjustment is at least this. Higher means only sharp movers qualify.'
  )
on conflict (key) do nothing;
