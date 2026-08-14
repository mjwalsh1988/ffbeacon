import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  BeamAliasesManager,
  type BeamAliasRow,
} from "@/components/admin/beam-aliases-manager";

export const metadata: Metadata = { title: "Player nicknames | Ask BEAM" };
export const dynamic = "force-dynamic";

/**
 * The nickname map. Read with an embedded player join so the list shows who each
 * alias points at without a second query.
 */
export default async function AdminBeamAliasesPage() {
  await requireAdmin("/admin/beam/aliases");

  const admin = createAdminClient();
  const { data } = await admin
    .from("beam_player_aliases")
    .select(
      "id, alias, alias_kind, is_active, source, note, players!inner(full_name, slug, position, team)",
    )
    .order("alias", { ascending: true })
    .limit(1000);

  type Row = {
    id: string;
    alias: string;
    alias_kind: string;
    is_active: boolean;
    source: string;
    note: string | null;
    players: {
      full_name: string | null;
      slug: string;
      position: string | null;
      team: string | null;
    } | null;
  };

  const rows: BeamAliasRow[] = ((data ?? []) as unknown as Row[])
    .filter((r) => r.players !== null)
    .map((r) => ({
      id: r.id,
      alias: r.alias,
      aliasKind: r.alias_kind,
      isActive: r.is_active,
      source: r.source,
      note: r.note,
      playerName: r.players!.full_name ?? r.players!.slug,
      playerSlug: r.players!.slug,
      position: r.players!.position,
      team: r.players!.team,
    }));

  return (
    <div>
      <Link
        href="/admin/beam"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to Ask BEAM
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Player nicknames
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
        BEAM resolves exact names, surnames, initials, and typos on its own. This list is
        for the things no algorithm gets: cmc, hollywood, sun god. {rows.length} in the
        map. When two players share an alias, BEAM asks rather than guessing, so a
        collision is safe.
      </p>

      <div className="mt-6">
        <BeamAliasesManager initial={rows} />
      </div>
    </div>
  );
}
