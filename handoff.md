# Handoff: Beacon Store and Personal Team Review build

Build complete through CM-T086 (the Trade Review as a second product family, and the team review offered after a draft). CM-T082 is the owner's. Committed and pushed through CM-T084 as ef284e4; CM-T085 and CM-T086 follow it. Plan: docs/completed/commerce/commerce-and-team-review-plan.md, section 22 lists what shipped differently, including both reviews, the 2026-10-31 owner changes, and the Trade Review. Task lines: progress.md, heading "Beacon Store and Personal Team Review".

## State

- Last task completed: CM-T086: the Trade Review ($3.95) sold above a Signal Check result, checkout at /tools/trade-calculator/review, one createOrderAction for both kinds; CM-T085 put the team reviews on the On The Clock post-draft screen; migration 0358
- Next task to start: CM-T082 (the owner watches the first live order; a Trade Review order has only been placed in test mode)
- Half-finished: none. No server running
- Gate after CM-T086: typecheck clean, lint 0 and 0, tests and build pass; the post-draft screen, the trade offer, the checkout and an order page checked in Chrome

## Migrations applied and verified

- 0343 to 0352 as planned, 0353_orders_owner_columns from the first review. All probed live with begin/rollback. Types regenerated after 0352; 0353 changes grants only, so types are unchanged.
- 0354 (initplan form for the four owner-read policies, indexes on orders.product_id and payment_webhook_events.order_id) and 0355 (receipt retry index covering skipped, partial indexes on paid_at and delivered_at) from the second review. Applied via MCP and read back from pg_policies and pg_indexes. Indexes and policy expressions only, so types are unchanged.
- 0356: the Basic Review priced at $4.95 (the owner's call, 2026-10-30). One data update on products, read back as 495.
- 0357: the Basic Review's description in the first person (2026-10-31). One data update on products; the Premium description already read that way.
- 0358: the Trade Review row, intake_form check widened to 'trade-review', placements check widened to 'on-the-clock' and 'trade-calculator', the team reviews given 'on-the-clock' (2026-10-31). Read back live; types unchanged (checks and data only).
- 0359 and 0360: turnarounds (2026-10-31). Trade Review 1 day with "within 24 hours, usually within an hour or two" in its tagline and features; Basic Review 2 days with "within 1 to 2 days"; Premium Review 3 days with "within 2 to 3 days". Data only.

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

## Reviewer findings on the Trade Review and post-draft offer (one reviewer, 2026-10-31, all resolved in code)

- HIGH import panel kept a share link made for one trade after another was picked, so the order could have gone to the wrong trade: a fresh run now clears the link and the saved id is held with the trade it belongs to.
- MEDIUM ordering from the import panel published a public share of a league trade with real team names: importAndAnalyze gained savePrivate and the order path uses it.
- MEDIUM with share links switched off the offer dead-ended: the trade calculator page withholds the offer when shareLinksEnabled is false, and both save paths say so if a save returns nothing.
- LOW ownership guard let a private row with no owner through; Stripe line read "Trade Review (Trade Review)"; the offer was not keyed per result; no announcement while saving; a dead re-export; the admin product form could not set intake_form (now derived from the family); "Michael will answer it" in E5. All fixed.
- Tests added from the review: lib/commerce/context.test.ts (ownership and what the stored context holds), findOpenDuplicate and listSubjectLine in orders.test.ts, components/commerce/review-href.test.ts, stripeLineName, intakeFormFor.

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
