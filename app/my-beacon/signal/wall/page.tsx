import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadOwnerSignal } from "@/lib/signal/editor-data";
import { parseWallGif, type WallPost, type WallImage } from "@/lib/signal-wall";
import { SignalEditorShell } from "@/components/signal/signal-editor-shell";
import { WallComposer } from "../wall-composer";
import { WallManager } from "../wall-manager";

export const metadata: Metadata = { title: "Wall | My Signal" };

const BUCKET = "signal-media";

export default async function SignalWallPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signal = await loadOwnerSignal(supabase, user!.id);
  if (!signal) redirect("/my-beacon/signal");

  const publicUrlFor = (path: string | null) =>
    path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;

  // Owner's own Wall posts, in any state. RLS signal_posts_select_own returns
  // the owner's posts including hidden ones, so the manager can flag takedowns.
  const { data: postRows } = await supabase
    .from("signal_posts")
    .select("id, body, pinned, hidden, hidden_reason, created_at, edited_at, gif")
    .eq("signal_id", signal.id)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = postRows ?? [];

  // Images for these posts (owner RLS returns the owner's own), grouped by post.
  const imagesByPost = new Map<string, WallImage[]>();
  if (rows.length > 0) {
    const { data: imageRows } = await supabase
      .from("signal_post_images")
      .select("post_id, storage_path, alt_text, width, height, ordinal")
      .in(
        "post_id",
        rows.map((r) => r.id),
      )
      .order("ordinal", { ascending: true });
    for (const img of imageRows ?? []) {
      const url = publicUrlFor(img.storage_path);
      if (!url) continue;
      const list = imagesByPost.get(img.post_id) ?? [];
      list.push({
        url,
        alt: img.alt_text,
        width: img.width,
        height: img.height,
      });
      imagesByPost.set(img.post_id, list);
    }
  }

  const wallPosts: WallPost[] = rows.map((row) => ({
    id: row.id,
    body: row.body,
    pinned: row.pinned,
    hidden: row.hidden,
    hiddenReason: row.hidden_reason,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    images: imagesByPost.get(row.id) ?? [],
    gif: parseWallGif(row.gif),
    // The owner editor manages posts only; comments are moderated on the public
    // Wall (where the owner gets inline hide/restore controls).
    comments: [],
  }));

  return (
    <SignalEditorShell
      title="Wall"
      description="Post short updates to your public profile. Visitors see your posts newest first, with any pinned post at the top, and they can follow you and react. You can edit or delete your posts at any time."
    >
      <div className="max-w-2xl space-y-6">
        <WallComposer />
        <WallManager posts={wallPosts} />
      </div>
    </SignalEditorShell>
  );
}
