# Handoff: Beacon Store and Personal Team Review build

Build complete through CM-T083 (the second, whole-build review). CM-T082 is the owner's. Nothing is committed. Plan: docs/completed/commerce/commerce-and-team-review-plan.md, section 22 lists what shipped differently, including the second review's changes and what it left. Task lines: progress.md, heading "Beacon Store and Personal Team Review".

## State

- Last task completed: CM-T083: second review by five reviewers over every file, every finding resolved or recorded in plan section 22
- Next task to start: Owner commit and deploy, then CM-T082
- Half-finished: none. No server running
- Gate after the second review: typecheck clean, lint 0 and 0, 7,754 tests in 561 files, build pass; neither review's fixes were re-run in a browser

## Migrations applied and verified

- 0343 to 0352 as planned, 0353_orders_owner_columns from the first review. All probed live with begin/rollback. Types regenerated after 0352; 0353 changes grants only, so types are unchanged.
- 0354 (initplan form for the four owner-read policies, indexes on orders.product_id and payment_webhook_events.order_id) and 0355 (receipt retry index covering skipped, partial indexes on paid_at and delivered_at) from the second review. Applied via MCP and read back from pg_policies and pg_indexes. Indexes and policy expressions only, so types are unchanged.
- 0356: the Basic Review priced at $4.95 (the owner's call, 2026-10-30). One data update on products, read back as 495.

## Reviewer findings (one reviewer, all resolved in code)

- HIGH closeOpenSession skipped expired orders and the cron expired settling payments: both now ask Stripe; new pending answer.
- HIGH paid event on a cancelled order stored the intent silently: now reported as a duplicate.
- MEDIUM reopening an expired order skipped coupon, capacity, storefront: rechecked.
- MEDIUM status form could deliver with no email, and move unpaid orders: refused, form narrowed.
- MEDIUM manual confirm left the card session payable: closed first.
- MEDIUM lost refund update read as already recorded: now a conflict, webhook retries.
- MEDIUM owner could read internal columns: migration 0353 and named columns.
- MEDIUM failed email showed as sent to the customer: row visible only when sent.
- MEDIUM checkout ignored ?source=: source now posted.
- MEDIUM Not received could expire within the hour: fresh expiry and reminder.
- LOW session write status guard, Open tile counting expired, E13 note lost on retry, focus and pending announcements: all fixed.
- Deliberately not acted on: none. Not reached by the reviewer: see plan section 22.

## Assumptions made

- CM-T002: Phase A reviews (CM-T012, CM-T053, CM-T069) are done by the main build agent, not sub-agents, because the owner asked for exactly one reviewer sub-agent at the end.
- CM-T005: order_events.body is capped at 5000, not the 2000 in plan 5.4, because the same section says an internal note (max 5000) is stored in that column.
- CM-T013: expireCheckoutSession treats any Stripe 400 as already-closed rather than matching an error code, because the caller retrieves the session and decides from its status either way; a retrieved open session aborts.
- CM-T015: formatMoney in lib/commerce/constants.ts always prints cents, because formatUsd prints $10 and $0 where the plan's copy says $5.00 off and $0.00.
- CM-T022: Plan step order kept: the coupon check (6.1 step 7) runs before the duplicate guard (step 9), so a customer who presses order again with a capped code while an unpaid order holds it reads You have already used that c...
- CM-T024: ATTENTION_FILTER became attentionFilter(now), a function, because the predicate holds two timestamps.
- CM-T025: Signed upload URLs use upsert true so a Retry can re-upload to the same path after a partial first attempt. Editing a published section is live at once (plan 3.7); Save changes publishes new rows and records delivery...
- CM-T027: markPaidIfWon returns a followUp closure for the receipt and A2, so each caller runs it in after(). The receipt for an admin-created order is E13 and goes through sendReceipt, so its status is tracked the same way. e...
- CM-T030: A lost chargeback's refunded event is written invisible, because plan 5.4 keeps chargeback rows from the customer.
- CM-T035: middleware.ts now excludes /api/orders/webhook like the donation webhook (not in the plan), so a forged POST cannot force an auth request before the signature check. A paid event on a card order the admin confirmed b...
- CM-T036: The donation webhook had no test file, so app/api/donate/webhook/route.test.ts is new.
- CM-T037: lib/commerce/context.ts is new, so the customer checkout and the admin complimentary order build the same context. The method switch is not in the 7.1 table; the action guards it with a conditional update instead.
- CM-T041: lib/commerce/offer.ts is new: the offer sits on busy league pages, so products, settings and the open count are memoized for 60 seconds in process, and createOrderAction counts again at order time.
- CM-T043: Changing the tier clears an applied code and says so, rather than re-previewing, because arrow keys change a radio on every press and the preview is rate limited.
- CM-T044: The checkout h1 is Personal Team Review through a new optional masthead prop; the league name drops to the line under it. Leader's dd changed from shrink-0 to max-w-[70%] with word breaks so a long league name cannot...
- CM-T045: My Beacon's layout holds the page h1, so the list's title and Order FFB-100001 are h2 (plan 12 says h1); the one-h1 rule wins. The product name sits under the order number as a paragraph.
- CM-T051: The My Beacon tile honors placements.myBeaconTile and that placement's view event fires from the tile.
- CM-T055: Added moveDeliverableAction (the section arrows), retryAttachmentUploadAction (the Retry button) and eastern-input.ts, because date-time inputs must read Eastern, not the device zone. loadSleeperHandleForUser lives i...
- CM-T075: The Stripe CLI is not installed and the owner ruled out endpoint changes, so CM-T076 uses real test-mode sessions through the app, and hand-signed events delivered to localhost for refund, chargeback, duplicate and r...
- CM-T076: Test emails went to the admin account through real Resend sends.
- CM-T078: Verification used an in-page audit script rather than a person walking every view at every width, because the extension disconnected mid-pass.

## Owner steps

- CM-T082: first live order watched end to end; a real Stripe event has never reached the route.
- Confirm STRIPE_ORDERS_WEBHOOK_SECRET in Vercel. Blueprint carry-overs: deploy, CRON_SECRET, 10:30 and 10:50 UTC market-signals runs, first-week size check (BP-T020).
