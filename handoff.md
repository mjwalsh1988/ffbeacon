# Handoff: Signal Scout Phase 8 COMPLETE + launch questions resolved (2026-07-11)

## Status summary
Phases 1-8 are complete and closed. A follow-up pass on 2026-07-11 resolved
every open question from the Phase 8 report.

- Safe to commit/review: YES.
- Safe to enable publicly: NO, not yet. Three owner actions remain (below).
- game_enabled: FALSE (re-confirmed; the gate row in signal_scout_settings is
  in place and was never flipped).

## 1. Environment variable name (RESOLVED)
The correct and only name is SIGNAL_SCOUT_IP_SALT. The Phase 8 chat report's
"SIGNAL_CONFIG salt" wording was a typo in the chat message header only:
repo-wide search shows zero SIGNAL_CONFIG matches in any file. The code reads
process.env.SIGNAL_SCOUT_IP_SALT at lib/signal-scout/route-helpers.ts:108,
falling back to a checked-in constant when unset. Regression tests already
exist (lib/signal-scout/route-helpers.test.ts covers the fallback and asserts
the hash changes when SIGNAL_SCOUT_IP_SALT is set), so a naming drift would
fail tests. No code change was needed.

## 2. Env documentation (UPDATED)
The project convention is .env.local.example (no README or env schema file
exists). Its entry now reads:

```
# Signal Scout guest IP hashing (optional locally; REQUIRED in Vercel Production).
# Strengthens the guest daily-round cap: without it the code falls back to a
# checked-in public constant, so the IP-hash side of the cap is precomputable.
SIGNAL_SCOUT_IP_SALT=replace-with-long-random-secret
```

No real secret is in the repo. To set it in Vercel: open the Vercel dashboard,
select the ffbeacon project, go to Settings, then Environment Variables, add
name SIGNAL_SCOUT_IP_SALT with a long random value (for example the output of
`openssl rand -base64 32`), scope it to Production (Preview optional), save,
and redeploy so the running deployment picks it up.

## 3. Guest cap / X-Forwarded-For launch check (INSTRUCTIONS FINAL)
Code confirmed: clientIp in lib/signal-scout/route-helpers.ts is the house
pattern (mirrors app/api/on-the-clock/leagues/route.ts; leftmost
x-forwarded-for entry, x-real-ip fallback, unit-tested). The guest cap
enforces max(guest-cookie count, salted-IP-hash count) atomically in the
claim RPC; verified live in the SS-T044 e2e run.

What cannot be verified from this machine: that Vercel's edge overwrites a
client-supplied X-Forwarded-For header in production. Important ordering
detail: POST /round returns 503 game_disabled BEFORE the guest cap runs, so
this test requires game_enabled temporarily true.

### Post-deploy XFF test (run these exact steps)
a. Deploy with game_enabled still false. This is safe: the public game page
   shows only the offline notice.
b. When ready to test, temporarily enable the game at
   /admin/signal-scout/settings (it is now publicly playable; do the test
   promptly).
c. From a terminal (logged out, no session), start guest round 1 and save the
   cookie jar:

```
curl -s -X POST https://ffbeacon.com/api/games/signal-scout/round -H "x-requested-with: ff-beacon" -c scout-jar.txt
```

   Note the roundId in the JSON response.
d. Skip round 1 (replace ROUND_ID):

```
curl -s -X POST https://ffbeacon.com/api/games/signal-scout/round/ROUND_ID/skip -H "x-requested-with: ff-beacon" -b scout-jar.txt
```

e. Wait at least 6 seconds (round-start rate window), then start and skip
   round 2 the same way (add -b scout-jar.txt to the start call so the same
   guest identity is reused). The cap (2 per ET day) is now exhausted.
f. Confirm the cookie side: a third start WITH the jar must return 429
   guest_limit_reached.
g. THE REAL TEST: a third start WITHOUT the cookie jar and with a spoofed
   header:

```
curl -s -X POST https://ffbeacon.com/api/games/signal-scout/round -H "x-requested-with: ff-beacon" -H "X-Forwarded-For: 1.2.3.4"
```

h. Interpretation:
   - 429 guest_limit_reached: Vercel overwrote the spoofed header, the IP
     side of the cap held. PASS.
   - 200 with a new round: the spoofed header was honored, the guest cap is
     bypassable via cookie rotation plus IP spoofing. DO NOT LAUNCH. Disable
     the game again and fix (strip client XFF or read a trusted platform
     header) before enabling.
i. If not launching immediately after a pass, flip game_enabled back to
   false.

## 4. Manual NVDA Launch Check (NOT PERFORMED; owner must run before enabling)
Run on the deployed site with NVDA, keyboard only:

1. Round start: open /games/signal-scout, navigate by headings (H key) to
   confirm the outline reads sensibly, activate "Start scouting", confirm the
   new-round state is announced once with no double speech.
2. Mystery profile and locked clues: read the profile card (should announce
   "Mystery player, identity classified", never a real name) and the locked
   slots list: each row should announce tier name, "Signal Locked", locked
   count, cost, and buys left, plus a reason when disabled.
3. Hint purchase: buy a Weak Signal hint. Focus should land on the new clue
   cell, which reads the clue once; the polite region should say only
   "Score N of 1000". Listen specifically for any double reading of the clue
   (this was fixed in SS-T045; verify the fix).
4. Burn confirmation: spend down until a hint costs at least your remaining
   score, then activate it. The dialog should announce "Confirm signal
   burnout" with initial focus on the cancel button ("Keep my signal");
   Escape must close it and return focus. Then confirm the burn: the burned
   banner should announce once, assertively, without overlapping or cut-off
   speech.
5. Wrong guess: type 2+ characters in the guess combobox, arrow through
   results (ruled-out players must be announced as unavailable and skipped),
   pick a wrong player, confirm the Bad Read announcement reads once with the
   updated count and score.
6. Results: finish rounds to hit at least Signal Found (win) and Signal
   Skipped. The result must announce once via the alert (headline, player
   name, points when won), focus must move to the result heading, and the
   player name must not be read twice on the reveal card.
7. Leaderboards: open /games/signal-scout/leaderboards, confirm the tab bar
   reports the active tab (aria-current), the table caption names the board
   and page, rows/columns navigate cleanly with table commands, the your-rank
   strip is readable, and the pager works keyboard-only.

Status: OUTSTANDING as of 2026-07-11. Do not enable the game publicly until
this walkthrough passes.

## 5. npm audit status (RE-VERIFIED, NON-BLOCKING)
npm audit --omit=dev re-run 2026-07-11: unchanged at 4 moderate findings, all
one root cause: postcss <8.5.10 (GHSA-qx2v-qp2m-jg93, XSS via unescaped
</style> in CSS stringify output) in the copy nested at
node_modules/next/node_modules/postcss, reached only through
@vercel/analytics -> next and geist -> next. The only fix npm offers is
`npm audit fix --force`, which would install next@9.3.3, a breaking
downgrade; rejected. This is a build-time CSS tooling path, not runtime code
Signal Scout exercises. NON-BLOCKING for Signal Scout launch. Follow-up:
revisit when @vercel/analytics and geist publish releases that no longer pin
vulnerable next ranges, or when next bumps its bundled postcss.

## 6. Verification state (after the follow-up edits)
- npm run typecheck: clean.
- npx vitest run: full suite passing (see progress.md Phase 8 follow-up).
- npm run build: production build passing end to end, reserved-route guard
  green, all 16 Signal Scout routes shipping.
- Working tree: uncommitted by instruction. Files changed in this follow-up
  pass: .env.local.example, progress.md, handoff.md only.

## Remaining owner actions (in order)
1. Review and commit the Signal Scout work on the current branch (nothing is
   committed; commit only on your instruction). Then deploy (safe while
   gated).
2. Set SIGNAL_SCOUT_IP_SALT in Vercel Production (section 2) and redeploy.
3. Run the post-deploy XFF test (section 3). If it fails, do not launch.
4. Run the Manual NVDA Launch Check (section 4).
5. When 2-4 are green, enable the game at /admin/signal-scout/settings.
6. Whenever convenient: decide SS-T035 (optional round history) and SS-T047
   (snap-share/red-zone clues); neither blocks anything. Post-launch
   follow-up: the postcss transitive advisory (section 5).

## Database state (production, unchanged from Phase 8 close)
- signal_scout_settings: one row, game_enabled false, defaults otherwise.
  This is the launch gate; do not delete it.
- All other signal_scout_* tables: 0 rows. Migrations 0123-0132 applied, no
  drift, next migration is 0133.

## Session rules in force
No commits, no pushes, no Chrome browser testing, game_enabled stays false,
plain ASCII punctuation everywhere, one shell command per tool call,
progress.md updated after every atomic task, owner uses a screen reader
(accessibility is the core differentiator).
