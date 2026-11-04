-- 0362: shorten bb_discord_edit_window_minutes from 30 to 10.
--
-- Access matrix: no table or policy change; one beacon_settings value.
--
-- A follow-up that joins a story's Discord card arrives as an edit, and a
-- Discord edit sends no notification. Both reviews of 0361 judged 30 minutes
-- too long to stay silent about a new fact (an injury moving from questionable
-- to out, trade terms arriving late), and the owner would rather see a second
-- card than miss one. Ten minutes still covers a reporter's burst: the
-- Brissett quotes came two and five minutes after the post they quoted.
--
-- Only rows still at the 0361 default move, so a value an admin already chose
-- is left alone.

update public.beacon_settings
set value = '10'::jsonb,
    description = 'A follow-up that quotes, replies to or retweets the story''s post, or carries the exact same event key, is added to the story''s card when the card is younger than this. Older cards get a new card instead, because a Discord edit sends no notification. Set 0 to always post a new card.'
where key = 'bb_discord_edit_window_minutes'
  and value = '30'::jsonb;
