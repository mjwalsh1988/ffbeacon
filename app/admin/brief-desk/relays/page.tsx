import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { BriefDeskPageShell } from "@/components/admin/brief-desk-page-shell";
import { RelaysManager, type RelayAdminRow } from "@/components/admin/brief-desk/relays-manager";
import { RELAY_KINDS, RELAY_KIND_LABELS, RELAY_STATUSES, parseRelayFacts } from "@/lib/relays/types";
import type { Database } from "@/lib/database.types";

export const metadata: Metadata = { title: "Relays" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const selectClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";

type Params = { q?: string; status?: string; kind?: string; week?: string; team?: string; page?: string };

function pageHref(params: Params, page: number): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return `/admin/brief-desk/relays${qs ? `?${qs}` : ""}`;
}

/**
 * Every week any Relay carries, every status and season, for the filter.
 * Paged rather than capped at 1000: a capped read ordered by week descending
 * quietly dropped the earliest weeks once the table passed a thousand rows,
 * the same fault lib/relays/load.ts loadRelayWeeks had. A season is about 900
 * rows, so this is one page in practice.
 */
async function loadAllWeeks(admin: ReturnType<typeof createAdminClient>): Promise<number[]> {
  const rows = await fetchAllRows("relay weeks", (from, to) =>
    admin
      .from("relays")
      .select("week")
      .not("week", "is", null)
      .order("week", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const weeks = new Set<number>();
  for (const r of rows) if (typeof r.week === "number") weeks.add(r.week);
  return [...weeks].sort((a, b) => b - a);
}

export default async function BriefDeskRelaysPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin("/admin/brief-desk/relays");
  const params = await searchParams;
  const admin = createAdminClient();

  const q = (params.q ?? "").trim().slice(0, 200);
  const status = (RELAY_STATUSES as readonly string[]).includes(params.status ?? "") ? params.status! : "";
  const kind = (RELAY_KINDS as readonly string[]).includes(params.kind ?? "") ? params.kind! : "";
  const weekNum = Number(params.week);
  const week = params.week && Number.isInteger(weekNum) && weekNum >= 0 && weekNum <= 22 ? weekNum : null;
  const teamId = params.team && /^[0-9a-f-]{36}$/i.test(params.team) ? params.team : "";
  const pageNum = Math.max(1, Math.floor(Number(params.page)) || 1);

  const [{ data: teamRows }, weeks] = await Promise.all([
    admin.from("nfl_teams").select("id, abbreviation, name").order("abbreviation", { ascending: true }),
    loadAllWeeks(admin),
  ]);
  const teams = (teamRows ?? []) as { id: string; abbreviation: string; name: string }[];

  // The team filter is an INNER JOIN, not a pre-read of ids. Reading the ids
  // first capped a busy team at an arbitrary thousand and made the "N Relays
  // match" count below wrong; the join keeps the filter, the order, the range
  // and the exact count on the server.
  const columns =
    "id, slug, headline, kind, season, week, status, status_reason, source_handle, source_url, source_posted_at, facts, timeline, brief_id, updated_at";
  let query = admin
    .from("relays")
    .select(teamId ? `${columns}, relay_teams!inner(team_id)` : columns, { count: "exact" });
  if (teamId) query = query.eq("relay_teams.team_id", teamId);
  if (q) query = query.ilike("headline", `%${q.replace(/[%_]/g, " ")}%`);
  if (status) query = query.eq("status", status);
  if (kind) query = query.eq("kind", kind);
  if (week !== null) query = query.eq("week", week);

  const from = (pageNum - 1) * PAGE_SIZE;
  const { data, count } = await query.order("source_posted_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // The select string is built at runtime, which supabase-js cannot type, so
  // the row shape is named here instead.
  type Row = Pick<
    Database["public"]["Tables"]["relays"]["Row"],
    | "id" | "slug" | "headline" | "kind" | "season" | "week" | "status" | "status_reason"
    | "source_handle" | "source_url" | "source_posted_at" | "facts" | "timeline" | "brief_id" | "updated_at"
  >;
  const rows: RelayAdminRow[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    slug: r.slug,
    headline: r.headline,
    kind: r.kind,
    season: r.season,
    week: r.week,
    status: r.status,
    statusReason: r.status_reason,
    sourceHandle: r.source_handle,
    sourceUrl: r.source_url,
    sourcePostedAt: r.source_posted_at,
    facts: parseRelayFacts(r.facts),
    timeline: r.timeline,
    briefId: r.brief_id,
    updatedAt: r.updated_at,
  }));

  return (
    <BriefDeskPageShell
      title="Relays"
      description="Every Relay, any status, newest first by the source post. Search the headline, filter by status, kind, week or team. Hide one with a reason, unhide it, retract it when the report was withdrawn, or edit its words: an edit re-runs the grounding check and publishes on a pass."
    >
      <div className="space-y-6">
        <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Search and filter Relays">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Headline contains</span>
            <input name="q" type="search" defaultValue={q} className={`${selectClass} w-64`} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Status</span>
            <select name="status" defaultValue={status} className={selectClass}>
              <option value="">All</option>
              {RELAY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Kind</span>
            <select name="kind" defaultValue={kind} className={selectClass}>
              <option value="">All</option>
              {RELAY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RELAY_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Week</span>
            <select name="week" defaultValue={week === null ? "" : String(week)} className={selectClass}>
              <option value="">All</option>
              {weeks.map((w) => (
                <option key={w} value={String(w)}>
                  {w === 0 ? "Off-season" : `Week ${w}`}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Team</span>
            <select name="team" defaultValue={teamId} className={selectClass}>
              <option value="">All</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.abbreviation})
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan"
          >
            Apply
          </button>
        </form>

        {/* No live region: the filter form is a full page load, so the
            attribute would never fire. The count is ordinary text right
            after the form. */}
        <p className="text-sm text-ink-muted">
          {total === 0 ? "No Relays match." : `${total} ${total === 1 ? "Relay" : "Relays"} match. Page ${pageNum} of ${pageCount}.`}
        </p>

        <RelaysManager relays={rows} />

        {pageCount > 1 ? (
          <nav aria-label="Relay pages" className="flex flex-wrap gap-3">
            {pageNum > 1 ? (
              <Link href={pageHref(params, pageNum - 1)} className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan">
                Previous page
              </Link>
            ) : null}
            {pageNum < pageCount ? (
              <Link href={pageHref(params, pageNum + 1)} className="inline-flex min-h-[44px] items-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink hover:border-brand-cyan">
                Next page
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </BriefDeskPageShell>
  );
}
