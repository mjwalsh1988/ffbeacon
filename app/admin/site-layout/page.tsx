import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { formatEastern } from "@/lib/datetime";
import { readSiteLayout, type StoredSiteLayout } from "@/lib/site-layout/settings";
import { SiteLayoutManager } from "./site-layout-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Site Layout" };

/**
 * The site layout admin surface: the order of the main menu, the order of the
 * all-tools page, and the homepage tool cards (order, width, tag, highlight).
 *
 * The form is drawn from a fresh read of the row, never the cached copy the
 * public pages use, because whatever this form shows is what the next save
 * writes back. For the same reason a FAILED read shows no form at all: a form
 * drawn from the defaults would look real, and saving it would overwrite the
 * stored layout with them.
 */
export default async function SiteLayoutAdminPage() {
  // Independent re-check, alongside the layout gate.
  await requireAdmin("/admin/site-layout");

  const stored = await readSiteLayout(createAdminClient());

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Site Layout</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        The order of the main menu and its Tools submenu, the order of the all tools page,
        and the homepage tool cards: their order, how wide each one is, which tag it
        carries and whether its border is highlighted. Nothing changes on the site until
        you press Save layout at the bottom of this page. After a save, every page shows
        the new layout the next time it loads.
      </p>

      {stored.status === "error" ? (
        <p
          role="alert"
          className="mt-6 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-4 py-3 text-sm text-signal-danger"
        >
          The saved layout could not be read just now, so the form is not shown. A form drawn
          without it would start from the shipped layout, and saving it would replace
          yours. Reload the page to try again.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-ink-muted">{savedLine(stored)}</p>
          <div className="mt-8">
            <SiteLayoutManager
              initialSettings={stored.settings}
              initialUpdatedAt={stored.status === "stored" ? stored.updatedAt : null}
            />
          </div>
        </>
      )}
    </div>
  );
}

function savedLine(stored: Exclude<StoredSiteLayout, { status: "error" }>): string {
  if (stored.status === "missing") {
    return "Nothing is stored yet, so the site is using the layout it shipped with.";
  }
  // The row migration 0282 seeded carries no author. Calling its timestamp
  // "last saved" would describe a save nobody made.
  if (!stored.updatedBy) {
    return "This is the layout the site carried when this page was added. Nobody has saved from this page yet.";
  }
  return `Last saved ${formatEastern(stored.updatedAt)}.`;
}
