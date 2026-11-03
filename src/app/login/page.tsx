import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/logo";
import { getCurrentUser } from "@/server/auth/session";
import { DEMO_ACCOUNTS, demoPassword, isDemoMode } from "@/server/demo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getCurrentUser()) redirect("/rfqs");
  const { next } = await searchParams;
  const demo = isDemoMode() ? { accounts: DEMO_ACCOUNTS, password: demoPassword() } : null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[380px]">
        <Wordmark className="mb-8" />
        <h1 className="text-title font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink-3">RFQ costing for Company A, Chakan.</p>

        <LoginForm next={next} demo={demo} />

        <p className="mt-10 text-xs leading-relaxed text-ink-3">
          Named-user access only. Drawings are covered by customer NDAs and every view or
          download is logged.
        </p>
      </div>
    </main>
  );
}
