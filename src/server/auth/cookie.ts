/**
 * Session cookie name. In production the `__Host-` prefix makes the browser refuse the cookie
 * unless it is Secure, host-only and Path=/; on http://localhost (no TLS) Safari would drop a
 * Secure cookie, so development uses a plain name. Shared by proxy.ts (edge of the request) and
 * the session module.
 */
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-qd_session" : "qd_session";
