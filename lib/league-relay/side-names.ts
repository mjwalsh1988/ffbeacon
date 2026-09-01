/**
 * Signal Check's "Side A" becomes the manager's actual name.
 *
 * Signal Check's verdict sentence and its plain-language read come from
 * admin-editable templates that call the two parties "Side A" and "Side B".
 * That is right on /tools/signal-check, where the two sides are columns on a
 * screen and have no other name.
 *
 * It is wrong in a Discord post. The relay has already named both managers in
 * its own first sentence, so a verdict that then says "Side A wins by 21.9%"
 * hands a reader two vocabularies for the same two people and leaves them to
 * work out which A is which. In their own league's channel, where everybody
 * knows everybody, that is the difference between a writeup and a report.
 *
 * So the sentence is renamed on the way out, and only here. The rename cannot
 * change what the sentence means: A stays A, B stays B, and nothing but the
 * noun moves. Editing the global template instead would rewrite
 * /tools/signal-check and the League Pulse transactions feed to suit Discord.
 *
 * This is the same trick lib/would-you-rather/side-names.ts plays, for the
 * opposite reason: that surface renames the sides to keep them ANONYMOUS, and
 * this one renames them to make them SPECIFIC. Two callers, two directions, one
 * pattern, and deliberately not shared: a single helper taking a lookup would
 * hide which surface is anonymising and which is identifying.
 *
 * Pure and word-boundaried, so "Sideline" and "Inside" are untouched.
 */

const SIDE_TOKEN = /\bSide ([AB])\b/g;

/**
 * Replace "Side A" and "Side B" with the two team names.
 *
 * Possessives come through intact because only the two words are matched:
 * "Side A's package" becomes "Yackson24's package".
 */
export function nameSides(text: string, teamA: string, teamB: string): string {
  return text.replace(SIDE_TOKEN, (_match, side: string) => (side === "A" ? teamA : teamB));
}
