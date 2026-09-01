import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern, formatRelative } from "@/lib/datetime";
import { loadLeagueRelaySettings } from "@/lib/league-relay/settings";
import { RELAY_MESSAGE_LABEL } from "@/lib/league-relay/default-settings";
import {
  RelaySettingsManager,
  type WebhookOption,
} from "./relay-settings-manager";
import {
  CommunityLeagueManager,
  type CommunityLeagueView,
} from "./community-league-manager";

export const metadata: Metadata = { title: "League Relay" };
export const dynamic = "force-dynamic";

const RECENT_POSTS = 25;

export default async function LeagueRelayPage() {
  await requireAdmin("/admin/league-relay");
  const admin = createAdminClient();

  const [settings, webhookRes, communityRes, settingsRowRes, postsRes] = await Promise.all([
    loadLeagueRelaySettings(admin),
    admin
      .from("discord_webhooks")
      .select("id, label, is_active")
      .order("created_at", { ascending: true }),
    admin
      .from("community_leagues")
      .select(
        "id, league_id, sleeper_league_id, label, is_active, watermark_at, last_synced_at, sync_status, sync_detail, leagues(name, season, total_rosters)",
      )
      .order("created_at", { ascending: true }),
    admin.from("league_relay_settings").select("updated_at").eq("id", "global").maybeSingle(),
    admin
      .from("league_relay_posts")
      .select("id, league_id, message_type, status, week, error, payload, created_at, posted_at")
      .neq("status", "reserved")
      .order("created_at", { ascending: false })
      .limit(RECENT_POSTS),
  ]);

  // The webhook URL is a secret and never leaves the server. Only the label and
  // the active flag cross to the client.
  const webhooks: WebhookOption[] = (webhookRes.data ?? []).map((w) => ({
    id: w.id,
    label: w.label,
    isActive: w.is_active,
  }));

  // Posts in the last seven days, per league. One grouped read rather than one
  // per row, so a page with twenty leagues still makes one query.
  const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const { data: recentCounts } = await admin
    .from("league_relay_posts")
    .select("league_id")
    .eq("status", "posted")
    .gte("created_at", since);
  const postCounts = new Map<string, number>();
  for (const row of recentCounts ?? []) {
    postCounts.set(row.league_id, (postCounts.get(row.league_id) ?? 0) + 1);
  }

  const leagues: CommunityLeagueView[] = (communityRes.data ?? []).map((c) => {
    const joined = (c as { leagues?: { name?: string; season?: number; total_rosters?: number } })
      .leagues;
    return {
      id: c.id,
      leagueRowId: c.league_id,
      sleeperLeagueId: c.sleeper_league_id,
      name: joined?.name ?? c.sleeper_league_id,
      label: c.label,
      season: joined?.season ?? null,
      totalRosters: joined?.total_rosters ?? null,
      isActive: c.is_active,
      watermarkAt: c.watermark_at,
      lastSyncedAt: c.last_synced_at,
      syncStatus: c.sync_status,
      syncDetail: c.sync_detail,
      postsLast7Days: postCounts.get(c.league_id) ?? 0,
    };
  });

  const posts = postsRes.data ?? [];
  const leagueNames = new Map(leagues.map((l) => [l.leagueRowId, l.label ?? l.name]));

  return (
    <div className="space-y-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">
          League Relay
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Community leagues in Discord
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          A community league resyncs every fifteen minutes instead of only when somebody
          opens it, and what changes gets written up and posted. Trades run through Signal
          Check and the trade impact model; waiver claims through the projections and the
          market; matchups through the same Power Pulse numbers the league page shows.
          Everything is off until you turn it on and choose a channel.
        </p>
      </header>

      <section aria-labelledby="leagues-heading" className="space-y-4">
        <h2 id="leagues-heading" className="text-lg font-semibold text-ink">
          Leagues
        </h2>
        <CommunityLeagueManager leagues={leagues} />
      </section>

      <section aria-labelledby="settings-heading" className="space-y-4">
        <h2 id="settings-heading" className="text-lg font-semibold text-ink">
          Settings
        </h2>
        {webhooks.length === 0 && (
          <p className="rounded-card border border-signal-warning/40 bg-signal-warning/5 p-4 text-sm text-ink-muted">
            No Discord webhooks are configured yet. Add one at System Settings, Discord
            webhooks, then come back and point each message type at a channel.
          </p>
        )}
        <RelaySettingsManager
          initialSettings={settings}
          webhooks={webhooks}
          lastUpdated={
            settingsRowRes.data?.updated_at ? formatEastern(settingsRowRes.data.updated_at) : null
          }
        />
      </section>

      <section aria-labelledby="log-heading" className="space-y-4">
        <h2 id="log-heading" className="text-lg font-semibold text-ink">
          Recent messages
        </h2>
        <p className="max-w-3xl text-sm text-ink-muted">
          Every message the relay claimed, whether or not it reached Discord. A row that
          says skipped or failed is the honest record of a message that did not go out, and
          the reason is next to it. The exact text sent is kept on each row, so a complaint
          about a writeup can be answered with what was actually said.
        </p>
        {posts.length === 0 ? (
          <p className="rounded-card border border-line bg-surface/40 p-4 text-sm text-ink-muted">
            Nothing yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">
                The {posts.length} most recent relay messages, newest first
              </caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-ink-subtle">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    When
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    League
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Type
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    What was said
                  </th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => {
                  const payload = post.payload as { title?: string } | null;
                  return (
                    <tr key={post.id} className="border-b border-line/60 align-top">
                      <td className="py-2 pr-3 text-xs text-ink-subtle">
                        {formatRelative(post.posted_at ?? post.created_at)}
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-muted">
                        {leagueNames.get(post.league_id) ?? "Removed league"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-muted">
                        {RELAY_MESSAGE_LABEL[
                          post.message_type as keyof typeof RELAY_MESSAGE_LABEL
                        ] ?? post.message_type}
                        {post.week ? ` (wk ${post.week})` : ""}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <StatusBadge status={post.status} />
                      </td>
                      <td className="py-2 text-xs text-ink-muted">
                        {payload?.title ?? post.error ?? "No message was built."}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The status, as a word rather than only a colour.
 *
 * Colour alone fails at WCAG 1.4.1 and fails anybody reading this in a
 * screen reader, and "skipped" versus "failed" is precisely the distinction an
 * admin is scanning for.
 */
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "posted"
      ? "border-signal-success/40 text-signal-success"
      : status === "error"
        ? "border-signal-danger/40 text-signal-danger"
        : "border-line text-ink-subtle";
  const label =
    status === "posted"
      ? "Posted"
      : status === "error"
        ? "Failed"
        : status === "skipped"
          ? "Skipped"
          : "Claimed";
  return (
    <span className={`inline-block rounded-pill border px-2 py-0.5 text-[11px] ${tone}`}>
      {label}
    </span>
  );
}
