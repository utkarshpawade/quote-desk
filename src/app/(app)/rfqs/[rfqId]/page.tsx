import Link from "next/link";
import { Section } from "@/components/ui/page";
import { Notice } from "@/components/ui/states";
import { Table, TableScroll, Td, Th, Tr } from "@/components/ui/table";
import { can } from "@/domain/permissions";
import { QUOTE_STATUS_LABEL } from "@/domain/status";
import { formatDateTime, formatINR, formatInteger, formatNumber } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { loadWorkspace } from "./data";
import { SubmitPanel } from "./submit-panel";

export default async function RfqOverview({ params }: { params: Promise<{ rfqId: string }> }) {
  const user = await requireUser();
  const ws = await loadWorkspace((await params).rfqId);
  const quote = ws.quote;
  const maxTiers = Math.max(1, ...ws.parts.map((p) => p.tiers.length));
  const returned = quote?.status === "DRAFT" && quote.decisionNote && quote.decidedAt;

  return (
    <div className="flex flex-col gap-5">
      {returned ? (
        <Notice tone="warn" title={`Returned by ${quote.decidedBy ?? "the sales head"} · ${formatDateTime(quote.decidedAt!)}`}>
          “{quote.decisionNote}”
        </Notice>
      ) : null}
      {ws.staleRates.length ? (
        <Notice tone="danger" title="Rates changed since this quote was priced">
          {ws.staleRates.map((r) => `${r.name}: ${r.used ?? "—"} → ${r.current ?? "—"}`).join(" · ")}. Open a part and save, or re-price, before submitting.
        </Notice>
      ) : null}

      <Section title="Prices" description="Unit price ex-GST per volume. The RFQ volume is marked and drives the approval rule." flush>
        <TableScroll>
          <Table className="min-w-[640px]">
            <thead>
              <tr>
                <Th>Part</Th>
                {Array.from({ length: maxTiers }, (_, i) => (
                  <Th key={i} numeric>
                    Volume {i + 1}
                  </Th>
                ))}
                <Th numeric>At RFQ volume / yr</Th>
              </tr>
            </thead>
            <tbody>
              {ws.parts.map((p) => {
                const base = p.tiers.find((t) => t.isBase);
                return (
                  <Tr key={p.id}>
                    <Td className="max-w-80">
                      <Link href={`/rfqs/${ws.id}/parts/${p.id}`} className="font-medium hover:text-accent hover:underline underline-offset-2">
                        {p.lineNo}. {p.description}
                      </Link>
                      <div className="truncate text-xs text-ink-3">
                        <span className="font-mono">{p.partNo}</span>
                        {p.materialText ? ` · ${p.materialText}` : ""}
                        {p.pendingReview ? <span className="text-ai"> · {p.pendingReview} values to review</span> : null}
                        {p.errors ? <span className="text-danger"> · {p.errors} issue{p.errors > 1 ? "s" : ""}</span> : null}
                      </div>
                    </Td>
                    {Array.from({ length: maxTiers }, (_, i) => {
                      const t = p.tiers[i];
                      return (
                        <Td key={i} numeric className={t?.isBase ? "bg-accent-soft/60" : ""}>
                          {t ? (
                            <>
                              <div className={t.unitPrice ? "font-medium" : "text-ink-4"}>{t.unitPrice ? formatNumber(t.unitPrice, 2) : "—"}</div>
                              <div className="text-xs text-ink-3">
                                {formatInteger(t.volume)}
                                {t.isBase ? " · RFQ" : ""}
                              </div>
                            </>
                          ) : (
                            <span className="text-ink-4">—</span>
                          )}
                        </Td>
                      );
                    })}
                    <Td numeric className="text-ink-2">
                      {base?.annualValue ? formatINR(base.annualValue) : <span className="text-ink-4">—</span>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      </Section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <SubmitPanel
          rfqId={ws.id}
          quote={quote ? { id: quote.id, status: quote.status } : null}
          approval={ws.approval}
          problems={ws.problems.map((p) => ({ ...p, href: p.partId ? `/rfqs/${ws.id}/parts/${p.partId}` : null }))}
          canSubmit={can(user.role, "quote.submit") && ws.status === "ESTIMATING"}
          stale={ws.staleRates.length > 0}
        />

        {quote ? (
          <Section title="Quote" description={`${quote.number} · ${QUOTE_STATUS_LABEL[quote.status]}`}>
            <ol className="flex flex-col gap-2 text-dense">
              {quote.submittedAt ? (
                <li>
                  Submitted by <span className="text-ink">{quote.submittedBy}</span> · <span className="text-ink-3">{formatDateTime(quote.submittedAt)}</span>
                </li>
              ) : null}
              {quote.decidedAt && quote.status !== "DRAFT" ? (
                <li>
                  {quote.requiresApproval ? (
                    <>
                      Approved by <span className="text-ink">{quote.decidedBy}</span>
                    </>
                  ) : (
                    "Approved by rule"
                  )}{" "}
                  · <span className="text-ink-3">{formatDateTime(quote.decidedAt)}</span>
                  {quote.decisionNote ? <div className="text-ink-3">{quote.decisionNote}</div> : null}
                </li>
              ) : null}
              {quote.sentAt ? (
                <li>
                  Sent to <span className="text-ink">{quote.sentTo}</span> by {quote.sentBy} · <span className="text-ink-3">{formatDateTime(quote.sentAt)}</span>
                </li>
              ) : null}
              {!quote.submittedAt ? <li className="text-ink-3">Not submitted yet.</li> : null}
            </ol>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-dense">
              <Link href={`/quotes/${quote.id}`} className="text-accent hover:underline underline-offset-2">
                Open quote document
              </Link>
              <a href={`/api/quotes/${quote.id}/pdf`} download className="text-accent hover:underline underline-offset-2">
                Download PDF
              </a>
            </div>
            {ws.revisions.length > 1 ? (
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-1 text-xs font-medium text-ink-3">Revisions</p>
                <ul className="text-dense">
                  {ws.revisions.map((r) => (
                    <li key={r.id} className="flex justify-between gap-3">
                      <Link href={`/quotes/${r.id}`} className="font-mono text-accent hover:underline underline-offset-2">
                        {r.number}
                      </Link>
                      <span className="text-ink-3">{QUOTE_STATUS_LABEL[r.status]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
