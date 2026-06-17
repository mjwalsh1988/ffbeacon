import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { ReactionsManager } from "@/components/admin/reactions-manager";
import { type ReactionKind, type ReactionType } from "@/lib/signal/reactions";

export const metadata: Metadata = { title: "Reactions" };
export const dynamic = "force-dynamic";

/**
 * Admin catalog for Signal custom reactions. Lists every reaction type (active and
 * disabled) in display order and lets an admin add, edit, reorder, disable, or
 * delete them. Reads via the service-role client because the catalog must show
 * disabled rows too and there is no client write path.
 */
export default async function AdminSignalReactionsPage() {
  await requireAdmin("/admin/signal/reactions");

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("signal_reaction_types")
    .select("id, slug, label, kind, char, image_path, display_order, is_active")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  const reactions: ReactionType[] = (rows ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    kind: r.kind as ReactionKind,
    char: r.char,
    image_path: r.image_path,
    display_order: r.display_order,
    is_active: r.is_active,
  }));

  return (
    <div>
      <Link
        href="/admin/signal"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to Signal
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Reactions
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        The catalog of reactions viewers can add to Wall posts and comments. Each
        reaction needs a label that screen readers read aloud. Disable a reaction to
        hide it from the picker while keeping its history and counts; a reaction can
        only be deleted once it has no reactions left on any post or comment.
      </p>

      <div className="mt-8">
        <ReactionsManager initial={reactions} />
      </div>
    </div>
  );
}
