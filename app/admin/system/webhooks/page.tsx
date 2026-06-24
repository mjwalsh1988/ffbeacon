import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import {
  WebhooksManager,
  type WebhookView,
} from "@/components/admin/beacon-brief/webhooks-manager";

export const metadata: Metadata = { title: "Webhooks" };
export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  await requireAdmin("/admin/system/webhooks");
  const admin = createAdminClient();
  const { data } = await admin
    .from("discord_webhooks")
    .select("id, label, is_active, url")
    .order("created_at", { ascending: true });

  // The URL is a secret: never send it to the client. Send only a short tail
  // hint so the admin can tell rows apart.
  const webhooks: WebhookView[] = (data ?? []).map((w) => ({
    id: w.id,
    label: w.label,
    is_active: w.is_active,
    urlHint: w.url.slice(-6),
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">
          System Settings
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Discord webhooks
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-muted">
          Manage the Discord incoming-webhook endpoints the site posts through
          (the Beacon Relay bot identity is applied automatically). Select which
          one the Beacon Brief uses on its Settings page. URLs are secret and
          never shown in full here.
        </p>
      </div>
      <WebhooksManager webhooks={webhooks} />
    </div>
  );
}
