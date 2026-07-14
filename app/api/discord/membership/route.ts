import { NextResponse } from "next/server";
import { isDiscordMember } from "@/lib/discord-membership";

/**
 * GET /api/discord/membership
 *
 * Returns { member: boolean } for the CURRENTLY authenticated user only.
 * The Discord id is derived server-side from the session (never from the
 * request), and the bot token stays server-side. Used by the floating
 * Discord CTA (a client component in the root layout) to hide itself for
 * confirmed guild members without forcing the whole layout to render
 * dynamically.
 *
 * `member` is true only when membership is positively confirmed; every other
 * state (no linked Discord, not a member, or an unverifiable check) returns
 * false so the invite keeps showing when we cannot be sure.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const member = await isDiscordMember();
  return NextResponse.json(
    { member },
    // Per-user + volatile: never let a shared cache hold this.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
