"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { getDummyHash, verifyPassword } from "./password";
import { clientIp, createSession, destroySession } from "./session";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 30;

const LoginInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(200)),
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

export type LoginState = { error?: string; email?: string };

/** Only same-site relative paths, so `?next=` can't be used as an open redirect. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/rfqs";
  return next;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
  });
  const typedEmail = String(formData.get("email") ?? "").slice(0, 200);
  if (!parsed.success) return { error: "Enter a valid email and your password.", email: typedEmail };

  const { email, password, next } = parsed.data;
  const ip = clientIp(await headers());
  const since = new Date(Date.now() - WINDOW_MS);

  const [emailFailures, ipFailures] = await Promise.all([
    db.loginAttempt.count({ where: { email, success: false, at: { gte: since } } }),
    ip ? db.loginAttempt.count({ where: { ip, success: false, at: { gte: since } } }) : 0,
  ]);
  if (emailFailures >= MAX_FAILURES_PER_EMAIL || ipFailures >= MAX_FAILURES_PER_IP) {
    return { error: "Too many failed attempts. Wait 15 minutes and try again.", email };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, active: true },
  });
  // Always run one scrypt so unknown emails take as long as wrong passwords.
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  const success = Boolean(user && user.active && passwordOk);

  await db.loginAttempt.create({ data: { email, ip, success } });
  if (!success || !user) return { error: "Email or password is incorrect.", email };

  await createSession(user.id);
  redirect(safeNext(next));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
