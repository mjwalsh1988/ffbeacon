import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// System Settings landing. Webhooks is the only sub-area today.
export default async function SystemSettingsPage() {
  redirect("/admin/system/webhooks");
}
