import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        title="Page not found"
        description="The RFQ, quote or page you followed does not exist, or the link is out of date."
        action={
          <Button asChild variant="primary">
            <Link href="/rfqs">Back to RFQs</Link>
          </Button>
        }
      />
    </main>
  );
}
