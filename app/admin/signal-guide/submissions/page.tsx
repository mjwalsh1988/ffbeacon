import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { guidePageTitle } from "@/lib/guide/registry";
import {
  GuideSubmissionsManager,
  type PendingSubmission,
} from "@/components/admin/guide-submissions-manager";
import { SITE_TIME_ZONE } from "@/lib/datetime";

export const metadata: Metadata = { title: "Community Questions | Signal Guide" };
export const dynamic = "force-dynamic";

/**
 * Admin queue of community-submitted questions awaiting review. Reads pending rows
 * via the service-role client (the table is service-role-only). Each row links into
 * the relevant page manager to answer it, or can be denied/deleted in place.
 */
export default async function AdminSignalGuideSubmissionsPage() {
  await requireAdmin("/admin/signal-guide/submissions");

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("guide_question_submissions")
    .select("id, name, email, question, page_key, created_at")
    .eq("status", "pending")
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

  const submissions: PendingSubmission[] = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    question: r.question,
    page_key: r.page_key,
    pageTitle: guidePageTitle(r.page_key),
    createdAtLabel: dateFmt.format(new Date(r.created_at)),
  }));

  return (
    <div>
      <Link
        href="/admin/signal-guide"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to Signal Guide
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Community questions
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Questions visitors submitted from a page&apos;s guide when they could not find an
        answer. Accept one to turn it into a published guide entry, or deny/delete it.
        {submissions.length > 0
          ? ` ${submissions.length} pending.`
          : ""}
      </p>

      <div className="mt-8">
        <GuideSubmissionsManager initial={submissions} />
      </div>
    </div>
  );
}
