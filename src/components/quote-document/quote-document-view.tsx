import type { QuoteDocument } from "@/domain/quote-document";
import { cn } from "@/lib/cn";
import { formatINR, formatInteger, formatNumber } from "@/lib/format";

const num = (v: string) => (v === "" ? "—" : formatNumber(v, 2).replace("-", "−"));

/**
 * The customer quote as HTML — the same data and order as the PDF (src/server/pdf), so what the
 * sales head approves on screen is exactly what the customer receives.
 */
export function QuoteDocumentView({ doc }: { doc: QuoteDocument }) {
  const separate = doc.parts.filter(
    (p) => p.tooling.mode === "SEPARATE" && Number(p.tooling.cost) > 0,
  );
  return (
    <article
      className="border-line bg-surface text-dense overflow-hidden rounded-lg border"
      aria-label={`Quotation ${doc.quote.number}`}
    >
      {doc.watermark ? (
        <p className="border-warn/20 bg-warn-soft text-warn border-b px-5 py-1.5 text-xs font-medium tracking-wide sm:px-8">
          {doc.watermark === "DRAFT"
            ? "DRAFT — figures change until the quote is submitted"
            : "FOR APPROVAL — not yet sent to the customer"}
        </p>
      ) : null}
      <div className="px-5 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-base font-semibold">{doc.company.name}</p>
            {doc.company.addressLines.map((l) => (
              <p key={l} className="text-ink-2">
                {l}
              </p>
            ))}
            <p className="text-ink-3 text-xs">GSTIN {doc.company.gstin}</p>
          </div>
          <div className="text-right">
            <p className="text-accent text-lg font-semibold tracking-wide">QUOTATION</p>
            <p className="font-mono">{doc.quote.number}</p>
            <p className="text-ink-2">{doc.quote.date}</p>
          </div>
        </header>

        <div className="border-line my-5 grid gap-4 border-y py-4 sm:grid-cols-2">
          <div>
            <p className="text-ink-3 text-xs font-medium tracking-wide">TO</p>
            <p className="font-semibold">{doc.customer.name}</p>
            {doc.customer.addressLines.map((l) => (
              <p key={l} className="text-ink-2">
                {l}
              </p>
            ))}
            {doc.customer.contactName ? (
              <p className="text-ink-2">Attn: {doc.customer.contactName}</p>
            ) : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
            {(
              [
                ["Your RFQ", doc.customer.customerRef, true],
                ["Our reference", doc.rfq.number, true],
                ["Subject", doc.rfq.subject, false],
                ["Valid until", doc.quote.validUntil, false],
                ["Rates as of", doc.quote.basisDate, false],
              ] as const
            ).map(([label, value, mono]) =>
              value ? (
                <div key={label} className="contents">
                  <dt className="text-ink-3">{label}</dt>
                  <dd className={cn(mono && "font-mono")}>{value}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </div>

        <section aria-labelledby="prices-h">
          <h2 id="prices-h" className="mb-2 text-sm font-semibold">
            Prices
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-line text-ink-3 border-b text-xs">
                  <th className="py-1.5 text-left font-medium">Part</th>
                  <th className="py-1.5 text-right font-medium">Volume / yr</th>
                  <th className="py-1.5 text-right font-medium">Unit price ₹</th>
                  <th className="py-1.5 text-right font-medium">GST ₹</th>
                  <th className="py-1.5 text-right font-medium">Incl. GST ₹</th>
                  <th className="py-1.5 text-right font-medium">Annual value ₹</th>
                </tr>
              </thead>
              <tbody>
                {doc.parts.map((p) =>
                  p.tiers.map((t, i) => (
                    <tr
                      key={`${p.lineNo}-${t.volume}`}
                      className={cn("border-line border-b", t.isBase && "bg-accent-soft/60")}
                    >
                      <td className="py-1.5 pr-3 align-top">
                        {i === 0 ? (
                          <>
                            <span className="font-medium">
                              {p.lineNo}. {p.description}
                            </span>
                            <span className="text-ink-3 block font-mono text-xs">
                              {p.partNo} · GST {p.gstPct} %
                            </span>
                          </>
                        ) : null}
                      </td>
                      <td className="num py-1.5">
                        {formatInteger(t.volume)}
                        {t.isBase ? "*" : ""}
                      </td>
                      <td className="num py-1.5 font-semibold">{num(t.unitPrice)}</td>
                      <td className="num py-1.5">{num(t.gstAmount)}</td>
                      <td className="num py-1.5">{num(t.priceInclGst)}</td>
                      <td className="num py-1.5">{num(t.annualValue)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <p className="text-ink-3 mt-1.5 text-xs">
            * Volume stated in your RFQ. GST is shown separately and is not part of the unit price.
          </p>
        </section>

        <section aria-labelledby="breakup-h" className="mt-6">
          <h2 id="breakup-h" className="mb-2 text-sm font-semibold">
            Cost breakup
          </h2>
          <div className="flex flex-col gap-5">
            {doc.parts.map((p) => (
              <div key={p.lineNo}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    {p.lineNo}. {p.description}
                  </p>
                  <p className="text-ink-3 font-mono text-xs">{p.partNo}</p>
                </div>
                <p className="text-ink-2">
                  {[
                    p.drawing && `Drawing ${p.drawing}`,
                    p.material,
                    `gross ${p.weights.grossKg} kg`,
                    p.weights.forgedKg && `forged ${p.weights.forgedKg} kg`,
                    `net ${p.weights.netKg} kg`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-ink-3 mb-2 text-xs">RM basis: {p.rmBasis}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] table-fixed border-collapse">
                    <colgroup>
                      <col className="w-[40%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-line text-ink-3 border-b text-xs">
                        <th className="py-1 text-left font-medium">₹ per piece</th>
                        {p.tiers.map((t) => (
                          <th key={t.volume} className="py-1 text-right font-medium">
                            {formatInteger(t.volume)} / yr{t.isBase ? "*" : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {p.breakup.map((row) => (
                        <tr
                          key={row.key}
                          className={cn(
                            "border-line border-b",
                            row.emphasis === "subtotal" && "border-t-ink-3 border-t font-semibold",
                            row.emphasis === "total" && "bg-accent-soft/60 font-semibold",
                          )}
                        >
                          <td className={cn("py-0.5", !row.emphasis && "text-ink-2 pl-2")}>
                            {row.label}
                          </td>
                          {row.values.map((v, i) => (
                            <td key={i} className="num py-0.5">
                              {num(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {p.tooling.mode === "AMORTIZED" ? (
                  <p className="text-ink-3 mt-1 text-xs">
                    Tooling {formatINR(p.tooling.cost)} amortized over {p.tooling.amortYears}{" "}
                    year(s) of volume and included above.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {separate.length ? (
          <section className="mt-6" aria-labelledby="tooling-h">
            <h2 id="tooling-h" className="mb-2 text-sm font-semibold">
              One-time tooling (charged separately)
            </h2>
            <ul className="divide-line border-line divide-y border-y">
              {separate.map((p) => (
                <li key={p.lineNo} className="flex justify-between gap-3 py-1.5">
                  <span>
                    {p.description} — {p.tooling.note ?? "dies and fixtures"}
                  </span>
                  <span className="num">{formatINR(p.tooling.cost)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-6" aria-labelledby="terms-h">
          <h2 id="terms-h" className="mb-2 text-sm font-semibold">
            Terms
          </h2>
          <ol className="text-ink-2 list-decimal space-y-1 pl-5">
            {doc.terms.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </section>

        <section className="mt-6" aria-labelledby="basis-h">
          <h2 id="basis-h" className="text-sm font-semibold">
            Rate basis
          </h2>
          <p className="text-ink-3 mb-2 text-xs">
            Every rate this quote was priced with, exactly as recorded in the rate masters.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse">
              <thead>
                <tr className="border-line text-ink-3 border-b text-xs">
                  <th className="py-1 text-left font-medium">Code</th>
                  <th className="py-1 text-left font-medium">Rate</th>
                  <th className="py-1 text-right font-medium">Value</th>
                  <th className="py-1 text-right font-medium">Effective from</th>
                </tr>
              </thead>
              <tbody>
                {doc.rateBasis.map((r) => (
                  <tr key={`${r.code}-${r.effectiveFrom}`} className="border-line border-b">
                    <td className="py-0.5 font-mono text-xs">{r.code}</td>
                    <td className="py-0.5">{r.name}</td>
                    <td className="num py-0.5">{r.value}</td>
                    <td className="num text-ink-2 py-0.5">{r.effectiveFrom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="border-line mt-6 grid gap-4 border-t pt-4 sm:grid-cols-2">
          <div>
            <p className="text-ink-3 text-xs font-medium tracking-wide">PREPARED BY</p>
            <p>{doc.signatures.preparedBy}</p>
          </div>
          <div>
            <p className="text-ink-3 text-xs font-medium tracking-wide">APPROVED BY</p>
            <p>
              {doc.signatures.approvedBy ??
                (doc.signatures.approvalNote ? "Approved by rule" : "Pending approval")}
              {doc.signatures.approvedOn ? ` · ${doc.signatures.approvedOn}` : ""}
            </p>
            {doc.signatures.approvalNote ? (
              <p className="text-ink-3 text-xs">{doc.signatures.approvalNote}</p>
            ) : null}
          </div>
          <p className="text-ink-3 text-xs sm:col-span-2">
            {doc.quote.number} · Rev {doc.quote.revision} · rates as of {doc.quote.basisDate}
            {doc.quote.shortHash ? ` · #${doc.quote.shortHash}` : " · not yet frozen"}
          </p>
        </footer>
      </div>
    </article>
  );
}

export function QuoteDocumentSkeleton() {
  return (
    <div
      className="border-line bg-surface animate-pulse rounded-lg border p-8"
      aria-busy="true"
      aria-label="Loading quote"
    >
      <div className="mb-6 flex justify-between">
        <div className="bg-subtle h-5 w-40 rounded" />
        <div className="bg-subtle h-5 w-28 rounded" />
      </div>
      {Array.from({ length: 10 }, (_, i) => (
        <div
          key={i}
          className="bg-subtle mb-3 h-3.5 rounded"
          style={{ width: `${60 + ((i * 17) % 40)}%` }}
        />
      ))}
    </div>
  );
}
