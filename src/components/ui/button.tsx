import { Slot } from "radix-ui";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover disabled:bg-accent/45 border border-transparent",
  secondary:
    "bg-surface text-ink border border-control hover:bg-hover disabled:text-ink-4 disabled:bg-surface",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink border border-transparent disabled:text-ink-4",
  danger: "bg-danger text-white hover:bg-danger/90 disabled:bg-danger/45 border border-transparent",
  link: "text-accent hover:underline underline-offset-2 border border-transparent px-0! h-auto!",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-dense gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
  icon: "h-8 w-8 justify-center",
};

export type ButtonProps = React.ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  asChild = false,
  className,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(
    "inline-flex shrink-0 items-center rounded-md font-medium whitespace-nowrap transition-colors select-none",
    "disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    className,
  );

  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  );
}
