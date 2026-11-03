import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { evaluateApproval } from "@/domain/costing/approval";
import type { LineDraft } from "@/domain/costing/draft";
import { computeCosting, normalizeCostingInput } from "@/domain/costing/engine";
import { gearBlankFixture, liftArmFixture, spindleFixture } from "@/domain/costing/fixtures";
import type { CostingInput } from "@/domain/costing/types";
import { buildQuoteDocument } from "@/server/services/quote-document";
import type { SnapshotBody, SnapshotLine } from "@/server/services/quote-lifecycle";
import { renderQuotePdf } from "./quote-pdf";

function line(lineNo: number, description: string, partNo: string, raw: CostingInput): SnapshotLine {
  const input = normalizeCostingInput(raw);
  return {
    partId: `p${lineNo}`,
    lineNo,
    partNo,
    description,
    drawingNo: `${partNo}-DRG`,
    drawingRev: "C",
    materialText: input.material?.name ?? null,
    hsnCode: null,
    gstClass: "GST_18",
    draft: { toolingMode: input.tooling.mode, toolingCost: input.tooling.cost, toolingAmortYears: input.tooling.amortYears, toolingNote: "Forging dies" } as LineDraft,
    input,
    result: computeCosting(input),
    provenance: {},
  };
}

function body(lines: SnapshotLine[]): SnapshotBody {
  const pct = (code: string, value: string) => ({ versionId: `v-${code}`, itemId: `i-${code}`, code, name: code, unit: "PERCENT" as const, value, effectiveFrom: "2025-09-22" });
  return {
    engineVersion: "1.0.0",
    quote: { id: "q1", number: "QT-2611-014-R0", revision: 0, basisDate: "2026-11-03", basisReason: null, marginBasis: "MFG_COST", validityDays: 30, documentDate: "2026-11-04" },
    rfq: { id: "r1", number: "RFQ-2611-014", subject: "Rear wheel spindle", customerRef: "CB/PUR/26/1182", receivedDate: "2026-11-02" },
    customer: { id: "c1", code: "CUST-B", name: "Company B", city: "Pune", address: "Plant 2, Akurdi\nPune 411035", contactName: "Purchase Manager", contactEmail: "purchase@companyb.example", paymentTerms: "60 days from invoice" },
    preparedBy: { id: "u1", name: "Rohan Deshpande" },
    params: { overheadPct: spindleFixture().overheadPct, iccRatePct: spindleFixture().iccRatePct, iccDays: spindleFixture().iccDays },
    policy: { resolvedOn: "2026-11-04", threshold: null, marginFloor: null, gst18: pct("GST_18", "18"), gst5: pct("GST_5", "5") },
    lines,
    approval: evaluateApproval([], "2500000"),
  };
}

async function pdfText(buffer: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text, totalPages };
}

describe("quote PDF", () => {
  it("prints prices, GST separately, the rate basis and a traceable footer", async () => {
    const doc = buildQuoteDocument(
      body([line(1, "Rear wheel spindle", "CB-RWS-0612", spindleFixture()), line(2, "Hydraulic lift arm", "CC-HLA-4410", liftArmFixture())]),
      { status: "SENT", shortHash: "a1b2c3d4", approvedBy: "Vikram Joshi", approvedOn: "2026-11-04", approvalNote: null },
    );
    const buffer = await renderQuotePdf(doc);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");

    const { text } = await pdfText(buffer);
    expect(text).toContain("QT-2611-014-R0");
    expect(text).toContain("₹");
    expect(text).toContain("120.46"); // spindle at the RFQ volume
    expect(text).toContain("1,109.59"); // lift arm at the RFQ volume
    expect(text).toContain("21.68"); // GST 18 % of 120.46, shown separately
    expect(text).toContain("Rate basis");
    expect(text).toContain("#a1b2c3d4");
    expect(text).not.toContain("DRAFT");
  });

  it("watermarks drafts and lists separately charged tooling", async () => {
    const doc = buildQuoteDocument(body([line(1, "Gear blank", "DRV-GB-2207", gearBlankFixture())]), {
      status: "DRAFT",
      shortHash: null,
      approvedBy: null,
      approvedOn: null,
      approvalNote: null,
    });
    const { text } = await pdfText(await renderQuotePdf(doc));
    expect(text).toContain("DRAFT");
    expect(text).toContain("One-time tooling");
    expect(text).toContain("2,40,000");
    expect(text).toContain("not yet frozen");
  });

  it("flows a long quote across pages", async () => {
    const parts = Array.from({ length: 6 }, (_, i) => line(i + 1, `Part ${i + 1}`, `P-${i + 1}`, liftArmFixture()));
    const { totalPages } = await pdfText(await renderQuotePdf(buildQuoteDocument(body(parts), { status: "APPROVED", shortHash: "ffff0000", approvedBy: null, approvedOn: null, approvalNote: "Approved by rule" })));
    expect(totalPages).toBeGreaterThan(1);
  });
});
