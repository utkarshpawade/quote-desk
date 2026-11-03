import { cn } from "@/lib/cn";

/** Status as dot + word (never colour alone). */
export function StatusDot({
  color,
  label,
  className,
}: {
  color: string; // a CSS colour or var(--color-…)
  label: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-dense whitespace-nowrap", className)}>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

type ChipTone = "neutral" | "accent" | "ai" | "ok" | "warn" | "danger";

const chipTones: Record<ChipTone, string> = {
  neutral: "border-line bg-subtle text-ink-2",
  accent: "border-accent-line bg-accent-soft text-accent",
  ai: "border-ai-line bg-ai-soft text-ai",
  ok: "border-ok/20 bg-ok-soft text-ok",
  warn: "border-warn/20 bg-warn-soft text-warn",
  danger: "border-danger/20 bg-danger-soft text-danger",
};

/** Small bordered label: rate-version chips, source chips, counts. */
export function Chip({
  tone = "neutral",
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone?: ChipTone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-xs whitespace-nowrap",
        chipTones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
