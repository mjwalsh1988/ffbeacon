import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { ProfileForm } from "./profile-form";
import { AvatarUploader } from "./avatar-uploader";

export const metadata: Metadata = {
  title: "Edit Profile",
  description:
    "Update your name, display name, Sleeper username, bio, and avatar.",
};

const AVATAR_SIGNED_URL_TTL = 60 * 60; // 1 hour

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("first_name, last_name, bio, avatar_path, sleeper_league_settings")
    .eq("user_id", user!.id)
    .maybeSingle();

  const settings = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);
  const displayName =
    typeof user!.user_metadata?.display_name === "string"
      ? (user!.user_metadata.display_name as string)
      : "";

  // The bucket is private, so render the current avatar through a short-lived
  // signed URL (the owner-scoped SELECT policy authorizes this).
  let avatarUrl: string | null = null;
  if (prefs?.avatar_path) {
    const { data } = await supabase.storage
      .from("user-avatars")
      .createSignedUrl(prefs.avatar_path, AVATAR_SIGNED_URL_TTL);
    avatarUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="space-y-12">
      <section aria-labelledby="profile-intro-heading">
        <SectionEyebrow>Your profile</SectionEyebrow>
        <h2
          id="profile-intro-heading"
          className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Make it yours.
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Your name, photo, and bio. This is the identity that will power your
          public FF Beacon profile once it ships, so set it up the way you want
          people to see you.
        </p>

        <div className="mt-6">
          <AvatarUploader initialAvatarUrl={avatarUrl} />
        </div>
      </section>

      <section aria-labelledby="profile-details-heading">
        <SectionEyebrow>Details</SectionEyebrow>
        <h2
          id="profile-details-heading"
          className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Name, handle, and bio.
        </h2>

        <div className="mt-6">
          <ProfileForm
            initialFirstName={prefs?.first_name ?? ""}
            initialLastName={prefs?.last_name ?? ""}
            initialDisplayName={displayName}
            initialSleeperUsername={settings.username ?? ""}
            initialBio={prefs?.bio ?? ""}
          />
        </div>
      </section>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
