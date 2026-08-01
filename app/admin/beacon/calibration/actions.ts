"use server";

/**
 * Server actions for the calibration reference. Every action re-checks admin via
 * requireAdmin (the client is never a security boundary) and writes through the
 * service-role client, matching app/admin/beacon/actions.ts.
 *
 * There is deliberately no action that edits a reference value. A reference is
 * built, validated, and activated as one immutable version, or it is discarded.
 * Hand-editing one player's position on the scale would produce a scale nothing
 * can reproduce or audit.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { loadBeaconSettings } from "@/lib/beacon/settings";
import { activateReferenceVersion, rebuildReferences } from "@/lib/beacon/reference";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Build and activate a new reference for one format, now, ignoring the cadence.
 * Every safety gate still runs: all expected sources present and fresh, the
 * shared set at or above the minimum, and the two-phase write verified in the
 * database before activation.
 */
export async function rebuildReferenceNow(formatSlug: string): Promise<ActionResult> {
  const { userId } = await requireAdmin("/admin/beacon/calibration");
  if (!formatSlug.trim()) return { ok: false, error: "Pick a format." };
  const admin = createAdminClient();
  try {
    const outcomes = await rebuildReferences(admin, {
      formatSlugs: [formatSlug],
      force: true,
      nowMs: Date.now(),
      actorId: userId,
      notes: "Manual rebuild from the admin calibration page.",
    });
    const o = outcomes[0];
    if (!o) return { ok: false, error: `No FF Beacon format matches ${formatSlug}.` };
    if (o.status !== "rebuilt") {
      return { ok: false, error: o.reason ?? "The rebuild was refused." };
    }
    revalidatePath("/admin/beacon/calibration");
    return {
      ok: true,
      message: `Built version ${o.version} for ${o.formatSlug} from ${o.players} shared players. It is now active.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Put a previous version back in charge. Same integrity checks as activation. */
export async function rollbackReference(versionId: string): Promise<ActionResult> {
  await requireAdmin("/admin/beacon/calibration");
  if (!versionId.trim()) return { ok: false, error: "Pick a version." };
  const admin = createAdminClient();
  try {
    const settings = await loadBeaconSettings(admin);
    await activateReferenceVersion(admin, versionId, settings.calibrationMinSharedPlayers);
    revalidatePath("/admin/beacon/calibration");
    return { ok: true, message: "That version is active again." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
