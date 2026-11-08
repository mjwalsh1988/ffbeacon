/**
 * The error codes every Long Shot route answers with, and their statuses.
 * A route sends { error: code } and the client maps the code to copy
 * (plan 18.2); no raw error text ever reaches a reader.
 */

export const LONG_SHOT_ERROR_STATUS = {
  invalid_request: 400,
  not_film_room: 400,
  login_required: 401,
  forbidden: 403,
  film_room_disabled: 403,
  not_found: 404,
  attempt_active: 409,
  attempt_closed: 409,
  stale_prompt: 409,
  no_puzzle: 409,
  rate_limited: 429,
  server_error: 500,
  game_disabled: 503,
  puzzle_unavailable: 503,
  leaderboards_disabled: 503,
} as const;

export type LongShotErrorCode = keyof typeof LONG_SHOT_ERROR_STATUS;

export class LongShotError extends Error {
  readonly code: LongShotErrorCode;
  readonly status: number;
  constructor(code: LongShotErrorCode) {
    super(code);
    this.code = code;
    this.status = LONG_SHOT_ERROR_STATUS[code];
  }
}

export function isLongShotError(err: unknown): err is LongShotError {
  return err instanceof LongShotError;
}
