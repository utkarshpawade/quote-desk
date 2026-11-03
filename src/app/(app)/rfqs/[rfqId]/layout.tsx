import type { Metadata } from "next";
import Link from "next/link";
import { DueLabel, RfqStatusLabel } from "@/components/rfq/labels";
import { Button } from "@/components/ui/button";
import { Breadcrumbs, Page } from "@/components/ui/page";
import { can } from "@/domain/permissions";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listEstimators } from "@/server/services/rfqs";
import { loadWorkspace } from "./data";
import { RepriceControl } from "./reprice-control";
import { RfqMenu } from "./rfq-menu";
import { WorkspaceTabs } from "./workspace-tabs";

export async function generateMetadata({ params }: { params: Promise<{ rfqId: string }> }): Promise<Metadata> {
  const ws = await loadWorkspace((await params).rfqId);
  return { title: `${ws.number} · ${ws.customer.name}` };
}

export default async function RfqLayout({ children, params }: { children: React.ReactNode; params: Promise<{ rfqId: string }> }) {
  const user = await requireUser();
  const ws = await loadWorkspace((await params).rfqId);
  const estimators = await listEstimators(db);
  const quote = ws.quote;
  const draft = quote?.status === "DRAFT";

  return (
    <Page className="pb-24">
      <Breadcrumbs items={[{ label: "RFQs", href: "/rfqs" }, { label: ws.number }]} />
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-title font-semibold tracking-tight">
            <span className="font-mono">{ws.number}</span>
            <span>{ws.customer.name}</span>
            <RfqStatusLabel status={ws.status} returned={draft && Boolean(quote?.decisionNote && quote.decidedAt)} className="text-sm font-normal" />
          </h1>
          <p className="mt-1 truncate text-sm text-ink-2">{ws.subject}</p>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-dense text-ink-3">
            <div className="flex gap-1.5">
              <dt>Received</dt>
              <dd className="text-ink-2">{formatDate(ws.receivedAt)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Due</dt>
              <dd className="flex gap-1.5 text-ink-2">
                {formatDate(ws.dueDate)} <DueLabel due={ws.due} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Owner</dt>
              <dd className="text-ink-2">{ws.owner.name}</dd>
            </div>
            {ws.customerRef ? (
              <div className="flex gap-1.5">
                <dt>Their ref</dt>
                <dd className="font-mono text-ink-2">{ws.customerRef}</dd>
              </div>
            ) : null}
            {quote ? (
              <div className="flex gap-1.5">
                <dt>Quote</dt>
                <dd className="font-mono text-ink-2">{quote.number}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quote && quote.status !== "DRAFT" ? (
            <Button asChild variant={user.role === "SALES_HEAD" && (quote.status === "IN_APPROVAL" || quote.status === "APPROVED") ? "primary" : "secondary"}>
              <Link href={`/quotes/${quote.id}`}>
                {quote.status === "IN_APPROVAL" && can(user.role, "quote.approve")
                  ? "Review & approve"
                  : quote.status === "APPROVED" && can(user.role, "quote.send")
                    ? "Send to customer"
                    : "View quote"}
              </Link>
            </Button>
          ) : null}
          {quote ? (
            <Button asChild variant="ghost">
              <a href={`/api/quotes/${quote.id}/pdf`} download>
                PDF
              </a>
            </Button>
          ) : null}
          <RfqMenu
            rfqId={ws.id}
            status={ws.status}
            overdue={ws.due?.kind === "overdue"}
            ownerId={ws.owner.id}
            estimators={estimators}
            canClose={can(user.role, "rfq.close")}
            canRevise={can(user.role, "costing.edit")}
          />
        </div>
      </header>

      {draft && quote ? (
        <div className="mt-3">
          <RepriceControl
            quoteId={quote.id}
            rfqId={ws.id}
            basisDate={quote.basisDate}
            basisReason={quote.basisReason}
            newerRates={ws.newerRates?.changedRates ?? []}
            receivedAt={ws.receivedAt}
            canEdit={can(user.role, "costing.edit")}
          />
        </div>
      ) : quote ? (
        <p className="mt-3 text-dense text-ink-3">
          Priced on rates as of <span className="text-ink-2">{formatDate(quote.basisDate)}</span>
          {quote.basisReason ? <> — {quote.basisReason}</> : null}
          {quote.snapshot ? (
            <>
              {" "}· frozen <span className="font-mono">#{quote.snapshot.hash.slice(0, 8)}</span>
            </>
          ) : null}
        </p>
      ) : null}

      <WorkspaceTabs
        rfqId={ws.id}
        parts={ws.parts.map((p) => ({
          id: p.id,
          lineNo: p.lineNo,
          description: p.description,
          pendingReview: p.pendingReview,
          errors: p.errors,
          returned: quote?.returnedPartIds.includes(p.id) ?? false,
        }))}
      />
      <div className="mt-5">{children}</div>
    </Page>
  );
}
