import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/** Standard page frame: consistent gutters (16 px phone, 24–32 px desktop). */
export function Page({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7", className)}>{children}</div>;
}

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-1.5">
      <ol className="flex flex-wrap items-center gap-1 text-dense text-ink-3">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3.5 text-ink-4" aria-hidden /> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-ink hover:underline underline-offset-2">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink-2">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Title row: title (+ meta line) on the left, actions on the right; wraps on phones. */
export function PageHeader({
  title,
  meta,
  actions,
  crumbs,
  className,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: Crumb[];
  className?: string;
}) {
  return (
    <header className={cn("mb-5 lg:mb-6", className)}>
      {crumbs ? <Breadcrumbs items={crumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-title font-semibold tracking-tight text-balance">{title}</h1>
          {meta ? <div className="mt-1 text-sm text-ink-3">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A titled white card. `flush` removes body padding for tables. */
export function Section({
  title,
  description,
  actions,
  flush = false,
  className,
  bodyClassName,
  children,
  id,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-lg border border-line bg-surface", className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
            {description ? <p className="text-xs text-ink-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(flush ? "" : "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
