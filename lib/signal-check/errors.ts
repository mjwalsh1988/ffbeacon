/**
 * Typed errors for the Signal Check pipeline. Server actions catch
 * SignalCheckError and surface `message` to the user as a clean validation
 * message; anything else is treated as an unexpected 500.
 */

export type SignalCheckErrorCode =
  | "redraft_picks_not_allowed"
  | "format_not_supported"
  | "empty_trade"
  | "too_many_assets"
  | "invalid_input";

export class SignalCheckError extends Error {
  code: SignalCheckErrorCode;
  constructor(code: SignalCheckErrorCode, message: string) {
    super(message);
    this.name = "SignalCheckError";
    this.code = code;
  }
}
