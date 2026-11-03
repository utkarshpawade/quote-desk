import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteDocumentView } from "@/components/quote-document/quote-document-view";
import { Breadcrumbs, Page } from "@/components/ui/page";
import { can } from "@/domain/permissions";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { getQuotePage } from "@/server/services/quote-page";
import { ApprovalRail } from "./approval-rail";

async function load(quoteId: string) {
  try {
    return await getQuotePage(db, quoteId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ quoteId: string }> }): Promise<Metadata> {
  const page = await load((await params).quoteId);
  return { title: `${page.number} · ${page.customer.name}` };
}

export default async function QuotePage({ params }: { params: Promise<{ quoteId: string }> }) {
  const user = await requireUser();
  const page = await load((await params).quoteId);

  return (
    <Page className="pb-28">
      <Breadcrumbs items={[{ label: "RFQs", href: "/rfqs" }, { label: page.rfq.number, href: `/rfqs/${page.rfq.id}` }, { label: page.number }]} />
      <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-mono text-title font-semibold">{page.number}</h1>
        <span className="text-title font-semibold">{page.customer.name}</span>
        <span className="text-sm text-ink-3">· {page.statusLabel}</span>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 min-w-0 xl:order-1">
          <QuoteDocumentView doc={page.document} />
        </div>
        <div className="order-1 xl:sticky xl:top-4 xl:order-2">
          <ApprovalRail page={page} canApprove={can(user.role, "quote.approve")} canSend={can(user.role, "quote.send")} />
        </div>
      </div>
    </Page>
  );
}
