import { cn } from "@/lib/cn";

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn("size-4 animate-spin", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
