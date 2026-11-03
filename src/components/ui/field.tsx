import { cn } from "@/lib/cn";

/** Label + control + hint/error, wired for screen readers via ids. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
  aside,
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-dense font-medium text-ink-2">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
