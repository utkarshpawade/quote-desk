import { cn } from "@/lib/cn";

/** Quote Desk mark: a ledger of three cost lines. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", className)} aria-hidden>
      <rect width="24" height="24" rx="5" className="fill-accent" />
      <rect x="6" y="7" width="12" height="2" rx="1" fill="white" />
      <rect x="6" y="11" width="9" height="2" rx="1" fill="white" fillOpacity="0.75" />
      <rect x="6" y="15" width="6" height="2" rx="1" fill="white" fillOpacity="0.5" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-sm font-semibold tracking-tight text-ink">Quote Desk</span>
    </span>
  );
}
