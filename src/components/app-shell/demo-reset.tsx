"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { resetDemoAction } from "@/app/(app)/demo-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/drawer";

/** Sales head, demo only: put every RFQ, quote, rate and import back to the starting data. */
export function DemoResetButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function reset() {
    start(async () => {
      const res = await resetDemoAction({});
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success("Demo data reset", { description: `${res.data.rfqs} RFQs and ${res.data.pastQuotes.toLocaleString("en-IN")} past quotes restored.` });
      router.push("/rfqs");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
        aria-label="Reset demo data"
        title="Reset demo data"
      >
        <RotateCcw className="size-4" strokeWidth={1.75} />
      </button>
      <Modal
        open={open}
        onOpenChange={(o) => !pending && setOpen(o)}
        title="Reset the demo data?"
        description="Every RFQ, quote, rate change, import and intake goes back to the starting data, dated from today. Everyone stays signed in. This also runs every night at 03:00."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={reset} loading={pending}>
              Reset demo
            </Button>
          </>
        }
      />
    </>
  );
}
