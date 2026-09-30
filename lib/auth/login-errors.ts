/**
 * The only errors /login will show from its own URL.
 *
 * /auth/callback used to put the auth provider's raw error message into
 * `/login?error=`, and the form printed `?error` as it found it. That made the
 * sign-in page a place anyone could put a sentence of their choosing, under
 * our heading, in a link that really is ffbeacon.com ("Your account is locked,
 * call this number"). It also passed on whatever detail the provider chose to
 * include.
 *
 * Now the callback sends a CODE from this fixed set, and the form shows the
 * message written here for it. An unknown code shows the generic message, and
 * nothing from the URL is ever rendered. Pure and client-safe.
 */

export const LOGIN_ERROR_MESSAGES = {
  missing_code:
    "That sign-in link was incomplete. Start again from this page.",
  link_expired:
    "That sign-in link has expired or was already used. Request a new one below.",
  auth_failed:
    "We could not finish signing you in. Please try again.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERROR_MESSAGES;

const GENERIC: LoginErrorCode = "auth_failed";

/** The message for a `?error=` value. Anything unrecognised gets the generic one. */
export function loginErrorMessage(code: unknown): string {
  if (typeof code === "string" && Object.prototype.hasOwnProperty.call(LOGIN_ERROR_MESSAGES, code)) {
    return LOGIN_ERROR_MESSAGES[code as LoginErrorCode];
  }
  return LOGIN_ERROR_MESSAGES[GENERIC];
}

/**
 * Supabase auth error codes that mean "the link is spent or stale", as opposed
 * to anything else going wrong. Read off `error.code`, never the message text.
 */
const EXPIRED_CODES = new Set([
  "otp_expired",
  "flow_state_expired",
  "flow_state_not_found",
  "bad_code_verifier",
]);

/** Map an auth error from the code exchange to a code in the fixed set. */
export function loginErrorCodeFor(error: { code?: unknown } | null | undefined): LoginErrorCode {
  const code = typeof error?.code === "string" ? error.code : "";
  return EXPIRED_CODES.has(code) ? "link_expired" : GENERIC;
}
