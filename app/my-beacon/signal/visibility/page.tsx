import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { loadOwnerSignal } from "@/lib/signal/editor-data";
import { SignalEditorShell } from "@/components/signal/signal-editor-shell";
import { PublishControls } from "../publish-controls";

export const metadata: Metadata = { title: "Visibility | My Signal" };

export default async function SignalVisibilityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signal = await loadOwnerSignal(supabase, user!.id);
  if (!signal) redirect("/my-beacon/signal");

  return (
    <SignalEditorShell
      title="Visibility"
      description="Your profile stays private until you publish it. Publish when you are ready, then choose whether anyone on the web can see it or only you. You can switch back to draft at any time."
    >
      <div className="max-w-2xl">
        <PublishControls
          initialStatus={signal.status}
          initialVisibility={signal.visibility}
          publicUrl={`${SITE.url}/${signal.handle}`}
        />
      </div>
    </SignalEditorShell>
  );
}
