import { NextResponse } from "next/server";
import { getIsAdmin } from "@/lib/admin-auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { ORDER_FILES_BUCKET } from "@/lib/commerce/constants";

/**
 * GET /api/orders/[order_id]/files/[deliverable_id]
 *
 * One attachment, to its owner or an admin. The bucket is private with no client
 * policies, so this is the only way to a file: the session must own the order or
 * be an admin, a customer gets only a published and ready row, and the answer is a
 * redirect to a signed URL that lives for 60 seconds.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;
const NO_STORE = { "Cache-Control": "private, no-store" };

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ order_id: string; deliverable_id: string }> },
) {
  const { order_id: orderId, deliverable_id: deliverableId } = await params;
  if (!UUID.test(orderId) || !UUID.test(deliverableId)) return notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return notFound();

  const admin = createAdminClient();
  const [{ data: order }, { data: file }, isAdmin] = await Promise.all([
    admin.from("orders").select("user_id").eq("id", orderId).maybeSingle(),
    admin
      .from("order_deliverables")
      .select("kind, storage_path, status, upload_state")
      .eq("id", deliverableId)
      .eq("order_id", orderId)
      .maybeSingle(),
    getIsAdmin(supabase),
  ]);
  if (!order || !file || file.kind !== "attachment" || !file.storage_path) return notFound();

  const owner = order.user_id === user.id;
  const visible = file.status === "published" && file.upload_state === "ready";
  if (!isAdmin && !(owner && visible)) return notFound();

  const { data: signed, error } = await admin.storage
    .from(ORDER_FILES_BUCKET)
    .createSignedUrl(file.storage_path, 60);
  if (error || !signed) return notFound();

  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: NO_STORE });
}
