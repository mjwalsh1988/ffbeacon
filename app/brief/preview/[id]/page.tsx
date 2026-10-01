import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { loadEditionForPreview } from "@/lib/brief-desk/edition-data";
import { EditionPage } from "@/components/brief-desk/edition-page";

/**
 * /brief/preview/[id]: any Brief edition rendered exactly as the public page
 * renders it, whatever its status (a backfill redo, a draft in review, or a
 * published edition), by its brief_editions id. For the owner to look at an
 * edition before it is published or applied (plan section 23.6).
 *
 * WHO MAY SEE IT. An admin, through requireAdmin, which sends anyone else to
 * the login page. One exception, for the owner's own machine only: a dev
 * server (NODE_ENV development) answering on localhost skips the login,
 * because a local sign-in is a second account setup for a page that only
 * ever reads. Both conditions must hold; a production build never takes it.
 *
 * Never indexed, never cached, never linked from a public page.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edition preview",
  robots: { index: false, follow: false },
};

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

async function isLocalDevelopment(): Promise<boolean> {
  if (process.env.NODE_ENV !== "development") return false;
  const host = (await headers()).get("host") ?? "";
  return LOCAL_HOST.test(host);
}

export default async function BriefEditionPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Validated first, so only a well-formed id ever reaches the login redirect.
  if (!z.string().uuid().safeParse(id).success) notFound();
  if (!(await isLocalDevelopment())) await requireAdmin(`/brief/preview/${id}`);
  const edition = await loadEditionForPreview(id);
  if (!edition) notFound();
  return (
    <main id="main">
      <p className="mx-auto max-w-5xl px-4 pt-4 text-sm font-semibold text-brand-cyan" role="note">
        Preview. This is how the edition renders; it is not the live page.
      </p>
      <EditionPage edition={edition} />
    </main>
  );
}
