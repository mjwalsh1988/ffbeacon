/**
 * One name per side, on this surface.
 *
 * Signal Check's verdict sentence and its plain-language read both come from
 * admin-editable templates that call the two parties "Side A" and "Side B".
 * That is right everywhere else in the product, where the side headings carry
 * real team names and "Side A" is the neutral way to refer to one of them.
 *
 * It is wrong here, and confusingly so. This game's two parties have no other
 * name: they ARE Team A and Team B, on the board, in the vote buttons, in the
 * results bars, in the Discord poll and in every sentence the game writes
 * itself. A reveal that then says "Side A wins by 11.3%" hands a reader two
 * vocabularies for the same two things and leaves them to work out that the
 * two As are the same A.
 *
 * So the sentence is renamed on the way out, and only here. The rename cannot
 * change what the sentence means: A stays A, B stays B, and nothing but the
 * noun moves. The alternative, editing the global template, would rewrite
 * /tools/signal-check and the League Pulse transactions feed to suit a game.
 *
 * Pure and word-boundaried, so "Sideline" and "Inside" are untouched and a
 * template that already says "Team A" is left exactly as it is.
 */

const SIDE_TOKEN = /\bSide ([AB])\b/g;

export function useTeamNames(text: string): string {
  return text.replace(SIDE_TOKEN, "Team $1");
}
