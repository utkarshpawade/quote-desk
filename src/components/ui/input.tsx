import { cn } from "@/lib/cn";

const base =
  "h-8 w-full min-w-0 rounded-md border border-control bg-surface px-2.5 text-sm text-ink " +
  "placeholder:text-ink-4 transition-colors outline-none " +
  "focus:border-accent focus:ring-2 focus:ring-accent/15 focus-visible:outline-none " +
  "disabled:bg-subtle disabled:text-ink-3 read-only:bg-subtle " +
  "aria-invalid:border-danger aria-invalid:focus:ring-danger/15";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(base, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(base, "h-auto min-h-24 py-2 leading-relaxed", className)} {...props} />;
}

/**
 * Numeric input for costing: right-aligned tabular figures with the unit as a quiet suffix.
 * Uses inputMode="decimal" text input so typing "0.61" never fights browser number spinners.
 */
export function NumberInput({
  unit,
  className,
  inputClassName,
  ...props
}: React.ComponentProps<"input"> & { unit?: string; inputClassName?: string }) {
  return (
    <div className={cn("relative", className)}>
      <input
        inputMode="decimal"
        autoComplete="off"
        className={cn(base, "num text-right", unit ? "pr-9" : "", inputClassName)}
        {...props}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-ink-3">
          {unit}
        </span>
      ) : null}
    </div>
  );
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        base,
        "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%236b7079%22 stroke-width=%221.5%22><path d=%22M4 6l4 4 4-4%22/></svg>')] bg-[length:14px] bg-[right_8px_center] bg-no-repeat pr-8",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
