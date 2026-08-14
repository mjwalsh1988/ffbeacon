import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { SITE_TIME_ZONE } from "@/lib/datetime";
import {
  BeamRequestsManager,
  type BeamRequestRow,
} from "@/components/admin/beam-requests-manager";

export const metadata: Metadata = { title: "Learning requests | Ask BEAM" };
export const dynamic = "force-dynamic";

/**
 * Submissions from the "Help BEAM learn this" form. Mirrors the Signal Guide
 * community-questions queue: read with the service role (the table has no client
 * policies), newest first, capped.
 */
export default async function AdminBeamRequestsPage() {
  await requireAdmin("/admin/beam/requests");

  const admin = createAdminClient();
  const { data } = await admin
    .from("beam_learning_requests")
    .select("id, question, name, email, message, status, admin_note, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const dateFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: SITE_TIME_ZONE,
    timeZoneName: "short",
  });

  const rows: BeamRequestRow[] = (data ?? []).map((r) => ({
    id: r.id,
    question: r.question,
    name: r.name,
    email: r.email,
    message: r.message,
    status: r.status,
    adminNote: r.admin_note,
    createdAtLabel: dateFmt.format(new Date(r.created_at)),
  }));

  const pending = rows.filter((r) => r.status === "pending").length;

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
        Learning requests
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
        People who hit a question BEAM could not answer and asked us to teach it. The
        question shown is the one BEAM actually logged, not text the submitter typed, so
        it always matches what failed.
        {pending > 0 ? ` ${pending} pending.` : ""}
      </p>

      <div className="mt-6">
        <BeamRequestsManager initial={rows} />
      </div>
    </div>
  );
}
