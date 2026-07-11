import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveUserIdentities } from "@/lib/user-identity";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { SignalScoutSubnav } from "@/components/admin/signal-scout-subnav";
import { Pager } from "@/components/admin/pager";
import { UserModeration } from "./user-moderation";
import { UserDetailPanel } from "./user-detail-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Signal Scout Users" };

const PAGE_SIZE = 25;
const REASON_EXCERPT_LENGTH = 40;

const userIdParamSchema = z.string().uuid();

type UserStatsRow = {
  user_id: string;
  total_points: number;
  rounds_played: number;
  rounds_won: number;
  best_signal_streak: number;
  last_played_date: string | null;
  hidden_from_leaderboards: boolean;
  hidden_reason: string | null;
};

function fmtCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function winRateLabel(won: number, played: number): { text: string; srOnly?: string } {
  if (played <= 0) return { text: "-", srOnly: "no data" };
  return { text: `${((won / played) * 100).toFixed(1)}%` };
}

function reasonExcerpt(reason: string | null): string {
  if (!reason || !reason.trim()) return "";
  const trimmed = reason.trim();
  return trimmed.length > REASON_EXCERPT_LENGTH ? `${trimmed.slice(0, REASON_EXCERPT_LENGTH)}...` : trimmed;
}

function buildUsersHref(params: { usersPage?: number; user?: string }): string {
  const search = new URLSearchParams();
  if (params.usersPage && params.usersPage > 1) search.set("usersPage", String(params.usersPage));
  if (params.user) search.set("user", params.user);
  const qs = search.toString();
  return qs ? `/admin/signal-scout/users?${qs}` : "/admin/signal-scout/users";
}

/**
 * Signal Scout Users admin page (SS-T039): paginated activity table, a
 * per-user drill-in, and leaderboard hide/unhide moderation.
 *
 * NO SEARCH FORM: unlike the Players page, signal_scout_user_stats has no
 * name column, and display names only exist after resolveUserIdentities runs
 * on the loaded page's user ids. A DB-side name search is impossible without
 * a denormalized name column, and filtering only the current page of ids
 * would silently miss every match outside that page, which is worse than no
 * search at all. Finding a specific user by name happens on the public
 * leaderboards or the Integrity tab; this page is reached from there via the
 * "user=<uuid>" drill-in link.
 */
export default async function SignalScoutUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ usersPage?: string; user?: string }>;
}) {
  // Independent re-check (defense in depth alongside the layout gate).
  await requireAdmin("/admin/signal-scout/users");

  const { usersPage, user: userParam } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(usersPage ?? "1", 10) || 1);

  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from("signal_scout_user_stats")
    .select("user_id", { count: "exact", head: true });

  let loadFailed = false;
  if (countError) {
    console.error("[signal-scout-admin] users count failed", countError);
    loadFailed = true;
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, pageNum), totalPages);
  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let rows: UserStatsRow[] = [];
  if (!loadFailed) {
    const { data, error } = await admin
      .from("signal_scout_user_stats")
      .select(
        "user_id, total_points, rounds_played, rounds_won, best_signal_streak, last_played_date, hidden_from_leaderboards, hidden_reason",
      )
      .order("total_points", { ascending: false })
      .order("user_id", { ascending: true })
      .range(from, to);
    if (error) {
      console.error("[signal-scout-admin] users page query failed", error);
      loadFailed = true;
    } else {
      rows = data ?? [];
    }
  }

  const identities = loadFailed
    ? new Map()
    : await resolveUserIdentities(
        admin,
        rows.map((r) => r.user_id),
        "private",
      );

  let selectedUserId: string | null = null;
  let selectedUserInvalid = false;
  if (userParam) {
    const parsed = userIdParamSchema.safeParse(userParam);
    if (parsed.success) {
      selectedUserId = parsed.data;
    } else {
      selectedUserInvalid = true;
    }
  }

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Users</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Activity and leaderboard moderation for Signal Scout players. Hiding removes a user
          from all public leaderboards but never blocks play.
        </p>
        <p className="mt-2 text-sm text-ink-subtle">
          Tip: find a user via the leaderboards or the Integrity tab, then open their detail here.
        </p>
      </div>

      <SignalScoutSubnav />

      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        {loadFailed ? (
          <ErrorBox message="Could not load Signal Scout users." />
        ) : (
          <>
            {selectedUserInvalid ? (
              <div className="rounded-card border border-line bg-surface/40 p-6">
                <p className="text-sm text-ink-muted">That user id is not valid.</p>
              </div>
            ) : selectedUserId ? (
              <UserDetailPanel userId={selectedUserId} />
            ) : null}

            <section aria-labelledby="users-list-heading">
              <h2 id="users-list-heading" className="sr-only">
                Signal Scout users
              </h2>

              {rows.length === 0 ? (
                <p className="rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
                  No Signal Scout users yet.
                </p>
              ) : (
                <>
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Signal Scout users table, scrollable"
                    className="overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    <table className="w-max min-w-full border-collapse text-sm">
                      <caption className="sr-only">
                        Signal Scout users by total points, page {currentPage} of {totalPages}.
                      </caption>
                      <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Scout
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Total points
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Rounds played
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Wins
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Win rate
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Best streak
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Last played
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Hidden
                          </th>
                          <th scope="col" className="px-3 py-2 text-left font-semibold">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const identity = identities.get(row.user_id);
                          const displayName = identity?.displayName ?? "Unknown scout";
                          const rate = winRateLabel(row.rounds_won, row.rounds_played);
                          const excerpt = reasonExcerpt(row.hidden_reason);

                          return (
                            <tr key={row.user_id} className="border-t border-line/60 align-top">
                              <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                                <div className="flex items-center gap-2.5">
                                  {/* alt="" is intentional: the display name renders as
                                      adjacent visible text right after the avatar. */}
                                  <ImageWithFallback src={identity?.avatarUrl ?? null} alt="" size={32} />
                                  <span>{displayName}</span>
                                </div>
                              </th>
                              <td className="px-3 py-2 text-ink">{fmtCount(row.total_points)}</td>
                              <td className="px-3 py-2 text-ink">{fmtCount(row.rounds_played)}</td>
                              <td className="px-3 py-2 text-ink">{fmtCount(row.rounds_won)}</td>
                              <td className="px-3 py-2 text-ink">
                                {rate.text}
                                {rate.srOnly ? <span className="sr-only"> ({rate.srOnly})</span> : null}
                              </td>
                              <td className="px-3 py-2 text-ink">{fmtCount(row.best_signal_streak)}</td>
                              <td className="px-3 py-2 text-ink">
                                {row.last_played_date ?? (
                                  <>
                                    <span aria-hidden="true">-</span>
                                    <span className="sr-only">no data</span>
                                  </>
                                )}
                              </td>
                              <td className="px-3 py-2 text-ink-muted">
                                {row.hidden_from_leaderboards ? `Yes${excerpt ? ` - ${excerpt}` : ""}` : "No"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-col gap-2">
                                  <Link
                                    href={buildUsersHref({ usersPage: currentPage, user: row.user_id })}
                                    className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-3 text-xs font-semibold text-ink hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                                  >
                                    Detail
                                  </Link>
                                  <UserModeration
                                    userId={row.user_id}
                                    displayName={displayName}
                                    isHidden={row.hidden_from_leaderboards}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pager
                    basePath="/admin/signal-scout/users"
                    paramName="usersPage"
                    currentPage={currentPage}
                    totalPages={totalPages}
                    label="Signal Scout users pages"
                  />
                </>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-sm text-signal-danger">
      {message}
    </p>
  );
}
