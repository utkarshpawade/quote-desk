"use client";

import { Menu, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { LogoMark, Wordmark } from "@/components/logo";
import type { CurrentUser } from "@/server/auth/session";
import { NavList, UserBlock } from "./nav";

export type ShellCounts = { approvals: number; readyToSend: number; pendingIntakes: number };

/**
 * Navigation adapts to the screen:
 * - ≥ 1536 px: full sidebar (224 px)
 * - 1024–1535 px: 56 px icon rail, so the costing screen keeps ~800 px for inputs on a 1366 laptop
 * - < 1024 px: top bar whose menu opens the full navigation in a drawer
 */
export function AppShell({
  user,
  counts,
  canResetDemo = false,
  children,
}: {
  user: CurrentUser;
  counts: ShellCounts;
  canResetDemo?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:pl-14 2xl:pl-56">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-14 flex-col border-r border-line bg-surface lg:flex 2xl:w-56">
        <div className="flex h-14 items-center justify-center 2xl:justify-start 2xl:px-4">
          <LogoMark className="2xl:hidden" />
          <Wordmark className="hidden 2xl:flex" />
        </div>
        <NavList user={user} counts={counts} rail />
        <UserBlock user={user} canResetDemo={canResetDemo} rail />
      </aside>

      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Wordmark />
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="-mr-2 inline-flex size-10 items-center justify-center rounded-md text-ink-2 hover:bg-hover"
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-[var(--shadow-drawer)] outline-none">
              <div className="flex h-12 items-center justify-between px-4">
                <Dialog.Title asChild>
                  <span>
                    <Wordmark />
                  </span>
                </Dialog.Title>
                <Dialog.Close
                  className="-mr-2 inline-flex size-10 items-center justify-center rounded-md text-ink-2 hover:bg-hover"
                  aria-label="Close navigation"
                >
                  <X className="size-5" />
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">Main navigation</Dialog.Description>
              <NavList user={user} counts={counts} onNavigate={() => setOpen(false)} />
              <UserBlock user={user} canResetDemo={canResetDemo} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </header>

      <main className="min-w-0">{children}</main>
    </div>
  );
}
