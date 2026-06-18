import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadOwnerSignal } from "@/lib/signal/editor-data";
import { SignalEditorShell } from "@/components/signal/signal-editor-shell";
import { HandleManager } from "../handle-manager";

export const metadata: Metadata = { title: "Handle | My Signal" };

export default async function SignalHandlePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signal = await loadOwnerSignal(supabase, user!.id);
  // No handle yet means no profile exists; the claim step lives on the hub.
  if (!signal) redirect("/my-beacon/signal");

  return (
    <SignalEditorShell
      title="Handle"
      description="This is your public address, the short link people type or share to find you. You can change it once every 30 days; reserved words are not allowed."
    >
      <div className="max-w-2xl">
        <HandleManager currentHandle={signal.handle} />
      </div>
    </SignalEditorShell>
  );
}
