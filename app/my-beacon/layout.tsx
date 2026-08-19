import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveFormats, getAvailableSources } from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { shortFormatName } from "@/lib/format-display";
import { SITE_TIME_ZONE } from "@/lib/datetime";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import type { SignalStatus } from "@/components/signal/signal-status-card";
import { BeaconRail, type BeaconRailFacts } from "./beacon-rail";

export const metadata: Metadata = {
  title: {
    template: "%s | My Beacon",
    default: "My Beacon",
  },
  description:
    "My Beacon is your personal fantasy cockpit: leagues, rankings, custom boards, and every FF Beacon tool in one accessible place.",
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

  // Everything the masthead and the rail need, in one pass. The registry reads
  // and the preference resolvers are React.cache'd, so a page that needs the
  // same values shares these Promises rather than running them again.
  const [
    { data: prefs },
    { data: signalRow },
    { count: boardCount },
    formats,
    sources,
    formatRes,
    sourceRes,
  ] = await Promise.all([
    supabase
      .from("user_preferences")
      .select("first_name, sleeper_league_settings, is_admin")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("signals")
      .select("id, handle, status, visibility, follower_count, avatar_path")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_ranking_boards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    getActiveFormats(supabase),
    getAvailableSources(supabase),
    // No URL params in this space, so the resolvers fall through DB, then
    // cookie, then default. For a signed-in user that is almost always the DB.
    resolveFormatSlug(supabase, undefined),
    resolveSourceSlug(supabase, undefined),
  ]);

  // Resolve the uploaded avatar (if any) to a public URL so the Signal card can
  // show it in place of the default emblem.
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

  // Greeting name priority: the auth display name, then the saved first name,
  // then the email's local part, then a friendly fallback.
  const metaDisplayName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  const firstName = prefs?.first_name?.trim() ?? "";
  const emailLocalPart = user.email ? user.email.split("@")[0] : "";
  const displayName =
    metaDisplayName || firstName || emailLocalPart || "fantasy player";

  const settings = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);

  // Leagues on the public profile: the union of "featured" and "shown". A
  // featured league counts even when it is not separately toggled to show,
  // because pinning it to the profile is itself a kind of visibility.
  const profileLeagueIds = new Set<string>(settings.shown_league_ids ?? []);
  if (settings.featured_league_id) {
    profileLeagueIds.add(settings.featured_league_id);
  }

  const formatFull =
    formats.find((f) => f.slug === formatRes.slug)?.display_name ?? "Not set";
  const sourceDisplay =
    sources.find((s) => s.slug === sourceRes.slug)?.display_name ?? "Not set";

  // Short month plus year reads more kindly than a full date, and avoids the
  // "member for N days" pattern.
  const memberSince = user.created_at
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: SITE_TIME_ZONE,
      }).format(new Date(user.created_at))
    : "Not known";

  const facts: BeaconRailFacts = {
    formatShort: shortFormatName(formatFull),
    formatFull,
    sourceDisplay,
    profileLeagueCount: profileLeagueIds.size,
    boardCount: boardCount ?? 0,
    sleeperUsername: settings.username?.trim() || null,
    memberSince,
    isAdmin: Boolean(prefs?.is_admin),
  };

  // The masthead carries this space's H1, so every child page starts at H2.
  return (
    <main id="main">
      <PageBody flush>
        <PageMasthead
          eyebrow="My Beacon"
          headingLevel="h1"
          title={`Welcome back, ${displayName}.`}
          description="Your fantasy cockpit: one place to run your leagues, your boards, your Signal, and every tool in the system. Same clarity, by eye or by ear."
        />
      </PageBody>

      <PageColumns
        railLabel="Your Signal and account summary"
        rail={<BeaconRail signal={signal} facts={facts} />}
      >
        {children}
      </PageColumns>
    </main>
  );
}
