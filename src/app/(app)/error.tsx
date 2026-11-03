"use client";

import { Button } from "@/components/ui/button";
import { Page } from "@/components/ui/page";
import { ErrorState } from "@/components/ui/states";

/** Error boundary for every signed-in page: a plain message and a retry, never a stack trace. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Page>
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState
          title="This page could not be loaded"
          description={
            <>
              Something went wrong on our side. Try again; if it keeps happening, share this reference with support:{" "}
              <span className="font-mono">{error.digest ?? "n/a"}</span>
            </>
          }
          action={<Button onClick={reset}>Try again</Button>}
        />
      </div>
    </Page>
  );
}
