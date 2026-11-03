import "server-only";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import type { Permission } from "@/domain/permissions";
import { getCurrentUser, type CurrentUser } from "./auth/session";
import { can } from "@/domain/permissions";
import { UserError, ForbiddenError, NotFoundError, ConflictError } from "./errors";

/**
 * Helpers for route handlers (uploads, downloads, intake, PDFs). Server actions get Origin
 * checking from Next.js; route handlers do it here.
 */

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Rejects cross-site requests to state-changing routes. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.APP_ORIGIN) allowed.add(process.env.APP_ORIGIN.replace(/\/$/, ""));
  return allowed.has(origin);
}

type RouteContext<P> = { params: Promise<P> };

/**
 * Wraps a route handler: session (401), permission (403), same-origin for non-GET (403), and
 * error mapping. The handler receives the signed-in user and resolved params.
 */
export function route<P = Record<string, string>>(
  options: { permission?: Permission },
  handler: (request: Request, ctx: { user: CurrentUser; params: P }) => Promise<Response>,
) {
  return async (request: Request, context: RouteContext<P>): Promise<Response> => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
        return jsonError(403, "Cross-site request refused.");
      }
      const user = await getCurrentUser();
      if (!user) return jsonError(401, "Sign in required.");
      if (options.permission && !can(user.role, options.permission)) {
        return jsonError(403, new ForbiddenError().message);
      }
      return await handler(request, { user, params: await context.params });
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof NotFoundError) return jsonError(404, error.message);
      if (error instanceof ForbiddenError) return jsonError(403, error.message);
      if (error instanceof ConflictError) return jsonError(409, error.message);
      if (error instanceof UserError) return jsonError(400, error.message, { fieldErrors: error.fieldErrors });
      console.error("[route] unexpected error", error);
      return jsonError(500, "Something went wrong. Please try again.");
    }
  };
}
