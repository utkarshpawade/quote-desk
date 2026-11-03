import { Page } from "@/components/ui/page";
import { Skeleton, TableSkeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <Page>
      <Skeleton className="mb-2 h-6 w-36" />
      <Skeleton className="mb-6 h-4 w-96 max-w-full" />
      <Skeleton className="mb-4 h-9 w-full max-w-xl" />
      <div className="rounded-lg border border-line bg-surface">
        <TableSkeleton rows={12} columns={8} />
      </div>
    </Page>
  );
}
