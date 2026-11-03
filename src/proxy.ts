import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/cookie";

/**
 * Optimistic gate: requests without a session cookie are sent to sign in before any page work
 * happens. This is not the security boundary — every page, action and route handler validates
 * the session and role against the database itself.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except sign-in, the demo-reset cron (bearer-token protected), Next internals and
  // static files.
  matcher: [
    "/((?!login|api/cron/|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|woff2?)$).*)",
  ],
};
