import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import {
  SignalStatusCard,
  type SignalStatus,
} from "@/components/signal/signal-status-card";

export const metadata: Metadata = {
  title: {
    template: "%s | My Beacon",
    default: "My Beacon",
  },
  description: "My Beacon is your personal fantasy cockpit: leagues, rankings, custom boards, and every FF Beacon tool in one accessible place.",
};

// Force-dynamic across the entire /my-beacon space because every page
// reads the authenticated user's session on the server.
export const dynamic = "force-dynamic";

export default async function MyBeaconLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/my-beacon");
  }

  // Greeting name priority: the auth display name, then the saved first name,
  // then the email's local part, then a friendly fallback. Fetched alongside
  // the user's Signal so the hero can render its status card on every page.
  const [{ data: prefs }, { data: signalRow }] = await Promise.all([
    supabase
      .from("user_preferences")
      .select("first_name")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("signals")
      .select("id, handle, status, visibility, follower_count, avatar_path")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  // Resolve the uploaded avatar (if any) to a public URL so the hero card can
  // show it in place of the default Signal emblem.
  const avatarUrl = signalRow?.avatar_path
    ? supabase.storage.from("signal-media").getPublicUrl(signalRow.avatar_path).data
        .publicUrl
    : null;
  // Count the posts that actually render on the public profile (hidden = admin
  // takedown, so excluded). Only runs when a Signal exists.
  let postCount = 0;
  if (signalRow) {
    const { count } = await supabase
      .from("signal_posts")
      .select("id", { count: "exact", head: true })
      .eq("signal_id", signalRow.id)
      .eq("hidden", false);
    postCount = count ?? 0;
  }
  const signal: SignalStatus = signalRow
    ? {
        handle: signalRow.handle,
        status: signalRow.status as "draft" | "published",
        visibility: signalRow.visibility as "public" | "private",
        followerCount: signalRow.follower_count ?? 0,
        postCount,
        avatarUrl,
      }
    : null;
  const metaDisplayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  const firstName = prefs?.first_name?.trim() ?? "";
  const emailLocalPart = user.email ? user.email.split("@")[0] : "";
  const displayName =
    metaDisplayName || firstName || emailLocalPart || "fantasy player";

  // The masthead carries this space's H1, so every child page starts at H2.
  return (
    <main id="main">
      <PageBody>
        <PageMasthead
          eyebrow="My Beacon"
          headingLevel="h1"
          title={`Welcome back, ${displayName}.`}
          description="My Beacon is your fantasy cockpit: one place to run your leagues, rankings, custom boards, and every tool in the system, with more landing here as we build it. Same clarity, by eye or by ear."
        >
          <div className="lg:max-w-sm">
            <SignalStatusCard signal={signal} />
          </div>
        </PageMasthead>
        <div className="mt-8">{children}</div>
      </PageBody>
    </main>
  );
}
