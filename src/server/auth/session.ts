import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { can, type Permission, type Role } from "@/domain/permissions";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { SESSION_COOKIE } from "./cookie";

/**
 * Database-backed sessions. The browser holds a random 256-bit token in an HttpOnly cookie that
 * lives only as long as the browser session; the database stores only the token's SHA-256, so a
 * leaked sessions table cannot be replayed. The server-side expiry slides: 12 hours after the last
 * activity, refreshed at most every 10 minutes so ordinary page loads don't write to the database.
 */

const IDLE_HOURS = 12;
const TOUCH_AFTER_MS = 10 * 60 * 1000;

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + IDLE_HOURS * 60 * 60 * 1000);
}

/** Client IP for throttling and access logs. Vercel sets x-real-ip / x-forwarded-for itself. */
export function clientIp(h: Headers): string | null {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const h = await headers();

  await db.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: expiryFrom(now),
      lastSeenAt: now,
      ip: clientIp(h),
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    },
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

/** The signed-in user for this request (one query per request), or null. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const id = hashToken(token);
  const session = await db.session.findUnique({
    where: { id },
    select: {
      expiresAt: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, name: true, role: true, active: true } },
    },
  });
  const now = new Date();
  if (!session || session.expiresAt <= now || !session.user.active) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.session
      .update({ where: { id }, data: { lastSeenAt: now, expiresAt: expiryFrom(now) } })
      .catch(() => undefined); // a failed touch must never break a page render
  }

  const { email, name, role } = session.user;
  return { id: session.user.id, email, name, role };
});

/** For pages and layouts: redirect anonymous visitors to sign in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** The user, or a ForbiddenError if their role lacks the permission. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) throw new ForbiddenError();
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: hashToken(token) } });
  store.delete(SESSION_COOKIE);
}
