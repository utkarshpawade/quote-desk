"use client";

import { CheckCircle2, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/page";
import type { ApprovalResult } from "@/domain/costing/approval";
import { formatINR, formatINRCompact } from "@/lib/format";
import { submitQuoteAction } from "../actions";

/**
 * The approval value against the ₹25 lakh rule, printed in full (lakh rounding would hide which
 * side of the line a quote sits), and Submit — with every blocking reason listed and linked, so
 * the button is never silently dead.
 */
export function SubmitPanel(props: {
  rfqId: string;
  quote: { id: string; status: string } | null;
  approval: ApprovalResult | null;
  problems: Array<{ partId: string | null; message: string; href: string | null }>;
  canSubmit: boolean;
  stale: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const a = props.approval;
  const draft = props.quote?.status === "DRAFT";

  function submit() {
    if (!props.quote) return;
    startTransition(async () => {
      const res = await submitQuoteAction({ quoteId: props.quote!.id, rfqId: props.rfqId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data.requiresApproval
          ? `Submitted — ${formatINRCompact(res.data.approvalValue)} is above ₹25 lakh, so it goes to the sales head.`
          : "Approved by rule — ready for the sales head to send.",
      );
      router.refresh();
    });
  }

  return (
    <Section title="Approval" description="Quotes above the threshold need the sales head; others are approved by rule.">
      {a ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-dense">
          <dt className="text-ink-3">Parts at RFQ volumes</dt>
          <dd className="num">{formatINR(a.partsValue)}</dd>
          <dt className="text-ink-3">Tooling charged separately</dt>
          <dd className="num">{formatINR(a.toolingValue)}</dd>
          <dt className="font-medium">Approval value</dt>
          <dd className="num font-semibold">{a.complete ? formatINR(a.approvalValue) : "—"}</dd>
          <dt className="text-ink-3">Threshold</dt>
          <dd className="num text-ink-3">{formatINR(a.threshold)}</dd>
          <dt className="text-ink-3">Most the customer could place (highest volumes)</dt>
          <dd className="num text-ink-3">{formatINR(a.maxExposure)}</dd>
        </dl>
      ) : (
        <p className="text-dense text-ink-3">No quote yet.</p>
      )}

      {a && a.complete ? (
        <p className="mt-3 text-dense">
          {a.requiresApproval ? (
            <span>
              <span className="font-medium">Needs sales head approval</span> — {formatINR(a.approvalValue)} &gt; {formatINR(a.threshold)}
            </span>
          ) : (
            <span>
              <span className="font-medium">Approved by rule on submit</span> — {formatINR(a.approvalValue)} ≤ {formatINR(a.threshold)}
            </span>
          )}
        </p>
      ) : null}

      {draft && props.canSubmit ? (
        <div className="mt-4 border-t border-line pt-4">
          {props.problems.length ? (
            <>
              <p className="mb-2 flex items-center gap-1.5 text-dense font-medium">
                <CircleAlert className="size-4 text-danger" aria-hidden /> Before you can submit
              </p>
              <ul className="mb-3 flex flex-col gap-1.5 text-dense text-ink-2">
                {props.problems.map((p, i) => (
                  <li key={i}>
                    {p.href ? (
                      <Link href={p.href} className="hover:text-accent hover:underline underline-offset-2">
                        {p.message}
                      </Link>
                    ) : (
                      p.message
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mb-3 flex items-center gap-1.5 text-dense text-ok">
              <CheckCircle2 className="size-4" aria-hidden /> Every part is priced and reviewed.
            </p>
          )}
          <Button variant="primary" onClick={submit} loading={pending} disabled={props.problems.length > 0 || props.stale} className="w-full justify-center sm:w-auto">
            Submit quote
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
