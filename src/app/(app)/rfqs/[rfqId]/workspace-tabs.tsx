"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

interface TabPart {
  id: string;
  lineNo: number;
  description: string;
  pendingReview: number;
  errors: number;
  returned: boolean;
}

/** Overview · one tab per part (the costing) · Files · Activity. Scrolls sideways on phones. */
export function WorkspaceTabs({ rfqId, parts }: { rfqId: string; parts: TabPart[] }) {
  const pathname = usePathname();
  const base = `/rfqs/${rfqId}`;
  const tabs = [
    { href: base, label: "Overview", exact: true, marker: null as React.ReactNode },
    ...parts.map((p) => ({
      href: `${base}/parts/${p.id}`,
      label: `${p.lineNo} · ${p.description}`,
      exact: false,
      marker:
        p.pendingReview > 0 ? (
          <span className="rounded-sm border border-ai-line bg-ai-soft px-1 text-xs text-ai">{p.pendingReview} to review</span>
        ) : p.returned ? (
          <span className="text-xs text-warn">returned</span>
        ) : p.errors > 0 ? (
          <span className="size-1.5 rounded-full bg-danger" aria-label={`${p.errors} issue(s)`} />
        ) : null,
    })),
    { href: `${base}/files`, label: "Files", exact: false, marker: null },
    { href: `${base}/activity`, label: "Activity", exact: false, marker: null },
  ];

  return (
    <nav aria-label="RFQ sections" className="-mx-4 mt-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-9 max-w-64 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap",
                  active ? "border-accent font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
                )}
              >
                <span className="truncate">{t.label}</span>
                {t.marker}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
