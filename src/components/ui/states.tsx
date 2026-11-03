import { AlertTriangle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/** Empty state: one sentence of what is missing and the next action — no illustration. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon ? <Icon className="mb-3 size-5 text-ink-4" strokeWidth={1.75} aria-hidden /> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-dense text-ink-3">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "This could not be loaded",
  description,
  action,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <AlertTriangle className="mb-3 size-5 text-danger" strokeWidth={1.75} aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-dense text-ink-3">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Inline notice bar for warnings, errors and information inside a page or card. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "warn" | "danger" | "ok" | "ai";
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-accent-line bg-accent-soft text-ink",
    warn: "border-warn/25 bg-warn-soft text-ink",
    danger: "border-danger/25 bg-danger-soft text-ink",
    ok: "border-ok/25 bg-ok-soft text-ink",
    ai: "border-ai-line bg-ai-soft text-ink",
  } as const;
  const bars = {
    info: "bg-accent",
    warn: "bg-warn",
    danger: "bg-danger",
    ok: "bg-ok",
    ai: "bg-ai",
  } as const;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("relative flex flex-wrap items-start gap-x-4 gap-y-2 overflow-hidden rounded-md border py-2.5 pr-3 pl-4", tones[tone], className)}
    >
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", bars[tone])} aria-hidden />
      <div className="min-w-0 flex-1 text-dense">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5 text-ink-2" : "")}>{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-subtle", className)} aria-hidden />;
}

/** Placeholder rows for tables while data loads. */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-24" : c === 1 ? "flex-1" : "w-16")} />
          ))}
        </div>
      ))}
    </div>
  );
}
