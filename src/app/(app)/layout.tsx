import { Suspense } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [approvals, readyToSend, pendingIntakes] = await Promise.all([
    db.quote.count({ where: { status: "IN_APPROVAL" } }),
    db.quote.count({ where: { status: "APPROVED" } }),
    db.intakeSession.count({ where: { status: "REVIEW" } }),
  ]);

  return (
    // The shell reads search params for the active nav item, which needs a Suspense boundary.
    <Suspense>
      <AppShell user={user} counts={{ approvals, readyToSend, pendingIntakes }}>
        {children}
      </AppShell>
    </Suspense>
  );
}
