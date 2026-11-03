import type { DueState } from "@/domain/calendar";
import { RFQ_STATUS_COLOR, RFQ_STATUS_LABEL, type RfqStatus } from "@/domain/status";
import { cn } from "@/lib/cn";
import { StatusDot } from "@/components/ui/badge";

export function RfqStatusLabel({ status, returned, className }: { status: RfqStatus; returned?: boolean; className?: string }) {
  return (
    <StatusDot
      color={RFQ_STATUS_COLOR[status]}
      className={cn("text-ink-2", className)}
      label={
        <>
          {RFQ_STATUS_LABEL[status]}
          {returned ? <span className="text-warn"> · returned</span> : null}
        </>
      }
    />
  );
}

/** Due date relative to today in working days. Colour only where it asks for action. */
export function DueLabel({ due, className }: { due: DueState | null; className?: string }) {
  if (!due) return null;
  if (due.kind === "overdue") {
    return <span className={cn("font-medium text-danger", className)}>Overdue {due.workingDays} wd</span>;
  }
  if (due.kind === "today") return <span className={cn("font-medium text-warn", className)}>Due today</span>;
  return (
    <span className={cn(due.workingDays <= 2 ? "font-medium text-warn" : "text-ink-3", className)}>
      {due.workingDays} wd left
    </span>
  );
}
