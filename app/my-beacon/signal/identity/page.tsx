import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSignalAccent, DEFAULT_ACCENT } from "@/lib/signal/accents";
import { loadOwnerSignal } from "@/lib/signal/editor-data";
import { SignalEditorShell } from "@/components/signal/signal-editor-shell";
import { IdentityForm } from "../identity-form";
import { AccentPicker } from "../accent-picker";
import { MediaUploader } from "../media-uploader";

export const metadata: Metadata = { title: "Identity | My Signal" };

const BUCKET = "signal-media";

export default async function SignalIdentityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signal = await loadOwnerSignal(supabase, user!.id);
  if (!signal) redirect("/my-beacon/signal");

  const publicUrlFor = (path: string | null) =>
    path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;

  const initialAccent = isSignalAccent(signal.accent)
    ? signal.accent
    : DEFAULT_ACCENT;

  return (
    <SignalEditorShell
      title="Identity"
      description="Tell visitors who you are. Your display name, headline, and bio appear at the top of your profile; your accent color, avatar, and banner set the look."
    >
      <div className="space-y-12">
        <section aria-labelledby="signal-identity-heading">
          <h3
            id="signal-identity-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Name and bio
          </h3>
          <div className="mt-4 max-w-2xl">
            <IdentityForm
              initialDisplayName={signal.display_name ?? ""}
              initialHeadline={signal.headline ?? ""}
              initialBio={signal.bio ?? ""}
            />
          </div>
        </section>

        <section aria-labelledby="signal-appearance-heading">
          <h3
            id="signal-appearance-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Accent color
          </h3>
          <div className="mt-4 max-w-2xl">
            <AccentPicker initialAccent={initialAccent} />
          </div>
        </section>

        <section aria-labelledby="signal-images-heading">
          <h3
            id="signal-images-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Avatar and banner
          </h3>
          <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
            <MediaUploader
              kind="avatar"
              initialUrl={publicUrlFor(signal.avatar_path)}
            />
            <MediaUploader
              kind="banner"
              initialUrl={publicUrlFor(signal.banner_path)}
            />
          </div>
        </section>
      </div>
    </SignalEditorShell>
  );
}
