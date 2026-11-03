"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { cn } from "@/lib/cn";

/** Right-hand side sheet for details (rate history, source excerpts, past quote detail). */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "md" | "lg";
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/15" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-[var(--shadow-drawer)] outline-none",
            width === "md" ? "sm:max-w-md" : "sm:max-w-2xl",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-dense text-ink-3">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Details</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="-mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
              aria-label="Close"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="border-t border-line px-5 py-3">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Centred dialog for confirmations and short forms. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface shadow-[var(--shadow-pop)] outline-none">
          <div className="px-5 pt-4">
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-1 text-dense text-ink-3">{description}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">Dialog</Dialog.Description>
            )}
          </div>
          {children ? <div className="px-5 py-4">{children}</div> : <div className="h-4" />}
          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
