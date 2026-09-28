/**
 * Error thrown by the server-side auth helpers.
 *
 * `code` is stable and safe to branch on; `status` is the HTTP status returned
 * by the Shopwave auth server when there was one.
 */
export type ShopwaveAuthErrorCode =
  | "config_invalid"
  | "token_exchange_failed"
  | "token_refresh_failed"
  | "token_response_invalid"
  | "network_error";

export class ShopwaveAuthError extends Error {
  readonly code: ShopwaveAuthErrorCode;
  readonly status?: number;
  /** Raw response body from the auth server, if any. Never contains our secret. */
  readonly body?: string;

  constructor(
    code: ShopwaveAuthErrorCode,
    message: string,
    details: { status?: number; body?: string; cause?: unknown } = {}
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = "ShopwaveAuthError";
    this.code = code;
    this.status = details.status;
    this.body = details.body;
  }

  /**
   * True when the auth server rejected the grant itself (bad/expired code or
   * refresh token) rather than failing for a transient reason. Callers should
   * treat the user as logged out.
   */
  get isInvalidGrant(): boolean {
    return (
      (this.code === "token_exchange_failed" || this.code === "token_refresh_failed") &&
      this.status !== undefined &&
      this.status >= 400 &&
      this.status < 500
    );
  }
}
