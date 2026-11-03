import { addDays, type IsoDate } from "@/domain/calendar";
import { breakupRows } from "@/domain/costing/labels";
import type { RateRef } from "@/domain/costing/types";
import { dec, money } from "@/domain/money";
import type { QuoteDocument, QuoteDocumentPart, QuoteDocumentStatus } from "@/domain/quote-document";
import { formatDate, formatINR } from "@/lib/format";
import { COMPANY } from "@/server/company";
import type { SnapshotBody, SnapshotLine } from "./quote-lifecycle";

/**
 * Maps a quote snapshot to the customer document. Frozen quotes render from their stored
 * snapshot; drafts from a live assembly with a DRAFT watermark. Either way the PDF and the HTML
 * view show exactly the same figures.
 */

const UNIT_LABEL: Record<RateRef["unit"], string> = {
  PER_KG: "₹/kg",
  PER_HOUR: "₹/h",
  PER_PIECE: "₹/pc",
  PERCENT: "%",
  RUPEES: "₹",
  COUNT: "",
  DAYS: "days",
};

const trim = (v: string) => v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

function rateText(ref: RateRef): string {
  const unit = UNIT_LABEL[ref.unit];
  if (ref.unit === "PERCENT") return `${trim(ref.value)} %`;
  if (ref.unit === "DAYS") return `${trim(ref.value)} days`;
  return `${formatINR(ref.value)}${unit.replace("₹", "")}`;
}

function gstPct(line: SnapshotLine, body: SnapshotBody): string {
  const ref = line.gstClass === "GST_5" ? body.policy.gst5 : body.policy.gst18;
  return ref ? trim(ref.value) : line.gstClass === "GST_5" ? "5" : "18";
}

function documentPart(line: SnapshotLine, body: SnapshotBody): QuoteDocumentPart {
  const pct = gstPct(line, body);
  const { input, result, draft } = line;
  const material = input.material;
  const rm = [
    material ? `${material.name} ${rateText(material)} w.e.f. ${formatDate(material.effectiveFrom)}` : "Material rate missing",
    input.turningsScrap ? `turnings ${rateText(input.turningsScrap)}` : null,
    input.flashScrap ? `flash ${rateText(input.flashScrap)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    lineNo: line.lineNo,
    partNo: line.partNo,
    description: line.description,
    drawing: line.drawingNo ? `${line.drawingNo}${line.drawingRev ? ` rev ${line.drawingRev}` : ""}` : null,
    material: line.materialText ?? material?.name ?? "—",
    hsnCode: line.hsnCode,
    gstPct: pct,
    weights: {
      grossKg: input.grossWeightKg ?? "—",
      forgedKg: input.forgedWeightKg,
      netKg: input.netWeightKg ?? "—",
    },
    tiers: result.tiers.map((t) => {
      const unit = t.lines?.unitPrice ?? null;
      const gst = unit ? money(dec(unit).times(pct).dividedBy(100)) : "";
      return {
        volume: t.volume,
        isBase: t.isBase,
        unitPrice: unit ?? "",
        gstAmount: gst,
        priceInclGst: unit ? money(dec(unit).plus(gst)) : "",
        annualValue: t.lines?.annualValue ?? "",
      };
    }),
    breakup: breakupRows(result).map((row) => ({
      key: row.key,
      label: row.label,
      emphasis: row.emphasis,
      values: row.values.map((v) => v ?? ""),
    })),
    tooling: {
      mode: draft.toolingMode,
      cost: draft.toolingCost,
      amortYears: draft.toolingAmortYears,
      note: draft.toolingNote,
    },
    rmBasis: rm,
  };
}

/** Every rate version the quote used, once each, in a stable order. */
function rateBasis(body: SnapshotBody): QuoteDocument["rateBasis"] {
  const seen = new Map<string, RateRef>();
  const add = (ref: RateRef | null | undefined) => {
    if (ref && !seen.has(ref.versionId)) seen.set(ref.versionId, ref);
  };
  for (const line of body.lines) {
    const i = line.input;
    [i.material, i.turningsScrap, i.flashScrap, i.packing, i.freight].forEach(add);
    i.bop.forEach((b) => add(b.rate));
    i.operations.forEach((o) => add(o.rate));
  }
  [body.params.overheadPct, body.params.iccRatePct, body.params.iccDays, body.policy.gst18, body.policy.gst5].forEach(add);
  return [...seen.values()].map((ref) => ({
    code: ref.code,
    name: ref.name,
    value: rateText(ref),
    unit: UNIT_LABEL[ref.unit],
    effectiveFrom: formatDate(ref.effectiveFrom),
  }));
}

export function buildQuoteDocument(
  body: SnapshotBody,
  meta: {
    status: QuoteDocumentStatus;
    shortHash: string | null;
    approvedBy: string | null;
    approvedOn: IsoDate | null;
    approvalNote: string | null;
  },
): QuoteDocument {
  const q = body.quote;
  const c = body.customer;
  const parts = body.lines.map((l) => documentPart(l, body));
  const separateTooling = body.lines
    .filter((l) => l.draft.toolingMode === "SEPARATE")
    .reduce((acc, l) => acc.plus(l.draft.toolingCost), dec(0));
  const notApproved = meta.status === "DRAFT" || meta.status === "IN_APPROVAL";

  return {
    status: meta.status,
    watermark: notApproved ? (meta.status === "DRAFT" ? "DRAFT" : "FOR APPROVAL") : null,
    company: { ...COMPANY, addressLines: [...COMPANY.addressLines] },
    quote: {
      number: q.number,
      revision: q.revision,
      date: formatDate(q.documentDate),
      validUntil: formatDate(addDays(q.documentDate, q.validityDays)),
      basisDate: formatDate(q.basisDate),
      shortHash: meta.shortHash,
      engineVersion: body.engineVersion,
    },
    customer: {
      name: c.name,
      addressLines: (c.address ? c.address.split("\n") : [c.city]).filter(Boolean),
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      customerRef: body.rfq.customerRef,
    },
    rfq: { number: body.rfq.number, subject: body.rfq.subject, receivedDate: formatDate(body.rfq.receivedDate) },
    parts,
    separateToolingTotal: money(separateTooling),
    terms: [
      "Prices are per piece in Indian rupees, delivered to your plant (FOR destination): packing and freight are included as shown in each cost breakup.",
      "GST is extra at the rate shown against each part; the HSN code is to be confirmed on your purchase order.",
      "Raw material is priced on the RM basis printed for each part and is subject to price variation under your RM policy.",
      "One-time tooling shown separately is not included in the piece price.",
      `Payment: ${c.paymentTerms}.`,
      `This quotation is valid for ${q.validityDays} days from ${formatDate(q.documentDate)}.`,
    ],
    rateBasis: rateBasis(body),
    signatures: {
      preparedBy: body.preparedBy.name,
      approvedBy: meta.approvedBy,
      approvedOn: meta.approvedOn ? formatDate(meta.approvedOn) : null,
      approvalNote: meta.approvalNote,
    },
  };
}
