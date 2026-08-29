import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern, formatRelative } from "@/lib/datetime";
import { describeSchedule } from "@/lib/would-you-rather/schedule";
import { describeRouting } from "@/lib/would-you-rather/routing";
import {
  loadWouldYouRatherSettings,
  WOULD_YOU_RATHER_SETTINGS_ID,
} from "@/lib/would-you-rather/settings";
import {
  WouldYouRatherSettingsManager,
  type WebhookOption,
} from "./would-you-rather-settings-manager";
import { ServedTradeRow } from "./served-trade-row";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Would You Rather" };

/**
 * The Would You Rather admin surface.
 *
 * Three things on one page, because they are read together: what the pool and
 * the vote counts currently look like, every setting behind the game, and the
 * recent Discord polls with what came back from each one.
 *
 * WEBHOOK URLS NEVER REACH THIS PAGE. The select carries labels and ids only.
 * A webhook URL is a bearer credential (anybody holding it can post to that
 * channel), so it stays server-side, exactly as /admin/system/webhooks treats
 * it.
 */
export default async function WouldYouRatherAdminPage() {
  // Independent re-check, alongside the layout gate.
  await requireAdmin("/admin/would-you-rather");

  const admin = createAdminClient();
  const settings = await loadWouldYouRatherSettings(admin);

  const [
    { data: row },
    { data: webhookRows },
    { count: activePool },
    { count: retiredPool },
    { count: siteVotes },
    { data: discordTotals },
    { data: polls },
    { data: recentlyServed },
  ] = await Promise.all([
    admin
      .from("would_you_rather_settings")
      .select("updated_at")
      .eq("id", WOULD_YOU_RATHER_SETTINGS_ID)
      .maybeSingle(),
    admin.from("discord_webhooks").select("id, label, is_active").order("label"),
    admin
      .from("would_you_rather_trades")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    admin
      .from("would_you_rather_trades")
      .select("id", { count: "exact", head: true })
      .eq("status", "retired"),
    admin.from("would_you_rather_votes").select("id", { count: "exact", head: true }),
    // The Discord total comes off the POLL rows, which are one per post, rather
    // than off every trade in the pool. Reading the pool for it was an unbounded
    // select that PostgREST truncates at 1,000 rows, so the figure would have
    // quietly started under-reporting the moment the pool passed that.
    admin
      .from("would_you_rather_discord_polls")
      .select("ingested_votes_a, ingested_votes_b")
      .not("results_ingested_at", "is", null),
    admin
      .from("would_you_rather_discord_polls")
      .select(
        "id, slot_key, route_key, webhook_id, posted_at, closes_at, results_ingested_at, ingested_votes_a, ingested_votes_b, voters_resolved, status, error, discord_message_id",
      )
      .order("posted_at", { ascending: false })
      .limit(15),
    admin
      .from("would_you_rather_trades")
      .select("id, sleeper_transaction_id, season, is_startup, votes_a, votes_b, served_count, last_served_at")
      .eq("status", "active")
      .not("last_served_at", "is", null)
      .order("last_served_at", { ascending: false })
      .limit(10),
  ]);

  const discordVotes = (discordTotals ?? []).reduce(
    (sum, p) => sum + (p.ingested_votes_a ?? 0) + (p.ingested_votes_b ?? 0),
    0,
  );

  const webhooks: WebhookOption[] = (webhookRows ?? []).map((w) => ({
    id: w.id,
    label: w.label,
    isActive: w.is_active,
  }));

  // A poll row stores the webhook it used, not the channel's name. Naming it
  // here is what lets an admin read the table as "which room got what" rather
  // than as a column of uuids. A webhook deleted since the post has no name
  // left to give, so the row says so instead of rendering a bare id.
  const webhookLabels = new Map((webhookRows ?? []).map((w) => [w.id, w.label]));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Would You Rather</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        The trade voting game at{" "}
        <span className="text-ink">/games/would-you-rather</span>. A real trade out of
        a synced league, with the managers anonymised, is put in front of a reader who
        calls the winner. Nothing about the grade reaches the browser until the vote is
        recorded.
      </p>

      {/* ---------- At a glance ---------- */}
      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Trades in the pool" value={(activePool ?? 0).toLocaleString()} />
        <Stat label="Retired" value={(retiredPool ?? 0).toLocaleString()} />
        <Stat label="Votes on site" value={(siteVotes ?? 0).toLocaleString()} />
        <Stat label="Votes from Discord" value={discordVotes.toLocaleString()} />
      </dl>

      <p className="mt-4 rounded-card border border-line bg-base/50 px-3.5 py-3 text-xs leading-relaxed text-ink-muted">
        <span className="font-medium text-ink">Discord poll: </span>
        {settings.discord.enabled
          ? describeSchedule(settings.discord.post_hours)
          : "Switched off. Nothing is being posted."}{" "}
        The cron behind it ticks every hour and does nothing on an hour you have not
        selected, so the frequency above is the whole schedule.{" "}
        {settings.discord.enabled && describeRouting(settings)}
      </p>

      <div className="mt-8">
        <WouldYouRatherSettingsManager
          initialSettings={settings}
          webhooks={webhooks}
          lastUpdated={row?.updated_at ?? null}
        />
      </div>

      {/* ---------- Recently served ---------- */}
      <section aria-labelledby="wyr-served-heading" className="mt-10">
        <h2 id="wyr-served-heading" className="text-lg font-semibold tracking-tight text-ink">
          Recently served trades
        </h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
          The last ten trades the game showed anyone. Retiring one stops it being
          served again; the votes already cast on it are a record of what people
          did and are kept.
        </p>

        {(recentlyServed ?? []).length === 0 ? (
          <p className="mt-4 rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-center text-sm text-ink-muted">
            Nothing has been served yet.
          </p>
        ) : (
          <ul role="list" className="mt-4 space-y-2">
            {(recentlyServed ?? []).map((trade) => (
              <ServedTradeRow
                key={trade.id}
                id={trade.id}
                label={`${trade.season ?? "Unknown season"} ${trade.is_startup ? "startup " : ""}trade ${trade.sleeper_transaction_id}`}
                votes={trade.votes_a + trade.votes_b}
                servedCount={trade.served_count}
                lastServedAt={trade.last_served_at}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---------- Recent polls ---------- */}
      <section aria-labelledby="wyr-polls-heading" className="mt-10">
        <h2 id="wyr-polls-heading" className="text-lg font-semibold tracking-tight text-ink">
          Recent Discord polls
        </h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
          One row per poll, keyed by the Eastern hour it was posted for, with the
          channel that hour's trade landed in. A poll sent by hand claims no hour,
          which is why that button is not rate limited. Results are read back
          once, some time after the poll closes, and added to that trade's tally;
          a row that has been counted can never be counted again. "By voter" means
          we read who voted and can drop anyone who has already called that trade;
          "totals only" means we could not, and that trade will not be posted
          again. A poll marked deleted had its Discord message removed before we
          could read it, so its votes are gone and nothing was counted.
        </p>

        {(polls ?? []).length === 0 ? (
          <p className="mt-4 rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-center text-sm text-ink-muted">
            No poll has been posted yet.
          </p>
        ) : (
          // tabIndex so the scroll container can be reached from the keyboard
          // when the table overflows. Without it, Safari gives a keyboard-only
          // reader no way to reach the Status column on a narrow window. Same
          // reason the navigation rail carries one.
          <div
            role="region"
            aria-label="Recent Discord polls"
            tabIndex={0}
            className="beacon-scroll mt-4 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <table className="w-full min-w-[54rem] text-sm">
              <caption className="sr-only">
                Discord polls, newest first, with their vote counts and status.
              </caption>
              <thead>
                <tr className="border-b border-line bg-surface-elevated/50 text-left">
                  <Th>Slot</Th>
                  <Th>Channel</Th>
                  <Th>Posted</Th>
                  <Th>Closes</Th>
                  <Th>Counted</Th>
                  <Th>How</Th>
                  <Th>Votes</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {(polls ?? []).map((poll) => (
                  <tr key={poll.id} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="px-3 py-2.5 text-left align-top font-normal">
                      {/* A manual post claims no schedule slot, which is what a
                          null slot_key means and why it is not rate limited. */}
                      {poll.slot_key ? (
                        <span className="font-mono text-xs tabular-nums text-ink-muted">
                          {poll.slot_key}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-subtle">Sent by hand</span>
                      )}
                    </th>
                    <Td>
                      {/* The FK nulls out when a webhook is deleted, so a row
                          can outlive the channel it names. Said plainly rather
                          than left blank or shown as a bare id. */}
                      {webhookLabels.get(poll.webhook_id ?? "") ?? "Deleted webhook"}
                    </Td>
                    <Td>{formatEastern(poll.posted_at)}</Td>
                    <Td>{formatEastern(poll.closes_at)}</Td>
                    <Td>
                      {poll.results_ingested_at
                        ? formatRelative(poll.results_ingested_at)
                        : "Not yet"}
                    </Td>
                    <Td>
                      {/* Only meaningful once the poll has been read back, so
                          an open poll says nothing rather than claiming the
                          default of false is a finding. */}
                      {poll.results_ingested_at ? (
                        poll.voters_resolved ? (
                          <span className="text-signal-success">By voter</span>
                        ) : (
                          <span className="text-ink-muted">Totals only</span>
                        )
                      ) : (
                        <span className="text-ink-subtle">Open</span>
                      )}
                    </Td>
                    <Td>
                      {poll.results_ingested_at ? (
                        <span className="font-mono tabular-nums">
                          A {poll.ingested_votes_a ?? 0} / B {poll.ingested_votes_b ?? 0}
                        </span>
                      ) : (
                        <span className="text-ink-subtle">Open</span>
                      )}
                    </Td>
                    <Td>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          poll.status === "error"
                            ? "border-signal-danger/50 bg-signal-danger/10 text-signal-danger"
                            : poll.status === "ingested"
                              ? "border-signal-success/50 bg-signal-success/10 text-signal-success"
                              : poll.status === "deleted"
                                ? "border-signal-warning/50 bg-signal-warning/10 text-signal-warning"
                                : "border-line text-ink-muted"
                        }`}
                      >
                        {poll.status}
                      </span>
                      {/* Server-written text only. Nothing a Discord user can
                          influence reaches this column, and it renders as text. */}
                      {poll.error && (
                        <span className="mt-1 block max-w-xs text-xs leading-relaxed text-ink-subtle">
                          {poll.error}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface/40 px-3.5 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle"
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 align-top text-ink-muted">{children}</td>;
}
