import { Page } from "@/components/ui/page";
import { Skeleton, TableSkeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <Page>
      <Skeleton className="mb-2 h-6 w-24" />
      <Skeleton className="mb-6 h-4 w-80" />
      <Skeleton className="mb-4 h-9 w-full max-w-xl" />
      <div className="rounded-lg border border-line bg-surface">
        <TableSkeleton rows={10} columns={7} />
      </div>
    </Page>
  );
}
