import { cn } from "@/lib/cn";

/**
 * Table primitives. Wrap in <TableScroll> so wide tables scroll inside their card on phones
 * instead of stretching the page. Numeric cells: <Td numeric>.
 */
export function TableScroll({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("w-full overflow-x-auto", className)}>{children}</div>;
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-dense", className)} {...props} />;
}

export function Th({
  numeric,
  className,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 border-b border-line bg-subtle/60 px-3 text-left text-xs font-medium whitespace-nowrap text-ink-3 first:pl-4 last:pr-4",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  numeric,
  className,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "h-10 border-b border-line px-3 align-middle first:pl-4 last:pr-4",
        numeric && "num",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("last:[&>td]:border-b-0", className)} {...props} />;
}
