"use client";

import {
  CheckSquare,
  FileSpreadsheet,
  History,
  Inbox,
  LogOut,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ROLE_LABEL } from "@/domain/permissions";
import { cn } from "@/lib/cn";
import { logout } from "@/server/auth/actions";
import type { CurrentUser } from "@/server/auth/session";
import type { ShellCounts } from "./app-shell";
import { DemoResetButton } from "./demo-reset";

type Item = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Count shown next to the label (null hides it). */
  count?: (c: ShellCounts, user: CurrentUser) => number | null;
  isActive: (pathname: string, view: string | null) => boolean;
};

const ITEMS: Item[] = [
  {
    href: "/rfqs",
    label: "RFQs",
    icon: Inbox,
    count: (c, user) => (user.role === "ESTIMATOR" && c.pendingIntakes > 0 ? c.pendingIntakes : null),
    isActive: (p, view) =>
      (p === "/rfqs" && view !== "approval" && view !== "ready") ||
      p.startsWith("/rfqs/") ||
      p.startsWith("/intake"),
  },
  {
    href: "/rfqs?view=approval",
    label: "Approvals",
    icon: CheckSquare,
    count: (c, user) => {
      if (user.role !== "SALES_HEAD") return null;
      const n = c.approvals + c.readyToSend;
      return n > 0 ? n : null;
    },
    isActive: (p, view) => (p === "/rfqs" && (view === "approval" || view === "ready")) || p.startsWith("/quotes/"),
  },
  {
    href: "/past-quotes",
    label: "Past quotes",
    icon: History,
    isActive: (p) => p.startsWith("/past-quotes"),
  },
  {
    href: "/rates",
    label: "Rate masters",
    icon: SlidersHorizontal,
    isActive: (p) => p.startsWith("/rates"),
  },
  {
    href: "/imports",
    label: "Import",
    icon: FileSpreadsheet,
    isActive: (p) => p.startsWith("/imports"),
  },
];

/** `rail`: labels collapse to icons between 1024 and 1535 px (desktop sidebar only). */
export function NavList({
  user,
  counts,
  rail = false,
  onNavigate,
}: {
  user: CurrentUser;
  counts: ShellCounts;
  rail?: boolean;
  /** Called when a link is followed (closes the phone drawer). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const view = useSearchParams().get("view");

  return (
    <nav className={"flex-1 overflow-y-auto px-2 py-2"} aria-label="Main">
      <ul className="flex flex-col gap-0.5">
        {ITEMS.map((item) => {
          const active = item.isActive(pathname, view);
          const count = item.count?.(counts, user) ?? null;
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={rail ? item.label : undefined}
                onClick={onNavigate}
                className={cn(
                  "relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                  rail && "justify-center px-0 2xl:justify-start 2xl:px-2.5",
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-2 hover:bg-hover hover:text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className={cn("flex-1 truncate", rail && "sr-only 2xl:not-sr-only")}>
                  {item.label}
                </span>
                {count !== null ? (
                  <>
                    <span
                      className={cn(
                        "num min-w-5 rounded-full px-1.5 text-center text-xs leading-5",
                        active ? "bg-accent text-white" : "bg-subtle text-ink-2",
                        rail && "hidden 2xl:inline",
                      )}
                    >
                      {count}
                    </span>
                    {rail ? (
                      <span
                        className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent 2xl:hidden"
                        aria-hidden
                      />
                    ) : null}
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function UserBlock({ user, canResetDemo = false, rail = false }: { user: CurrentUser; canResetDemo?: boolean; rail?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 border-t border-line px-3 py-3",
        rail && "flex-col px-2 2xl:flex-row 2xl:px-3",
      )}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-medium text-ink-2"
        title={rail ? `${user.name} · ${ROLE_LABEL[user.role]}` : undefined}
        aria-hidden
      >
        {initials(user.name)}
      </span>
      <div className={cn("min-w-0 flex-1", rail && "sr-only 2xl:not-sr-only")}>
        <p className="truncate text-dense font-medium">{user.name}</p>
        <p className="truncate text-xs text-ink-3">{ROLE_LABEL[user.role]}</p>
      </div>
      {canResetDemo ? <DemoResetButton /> : null}
      <form action={logout}>
        <button
          type="submit"
          className="inline-flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="size-4" strokeWidth={1.75} />
        </button>
      </form>
    </div>
  );
}
