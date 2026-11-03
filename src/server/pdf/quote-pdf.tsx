import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { QuoteDocument, QuoteDocumentPart } from "@/domain/quote-document";
import { formatInteger, formatNumber, formatINR } from "@/lib/format";

/**
 * The customer quote as a PDF. Fonts are registered once at module scope from a static path so
 * Vercel's file tracing ships them (see next.config.ts) and a missing file fails loudly.
 * IBM Plex has the ₹ glyph and tabular figures, so money columns align without a mono font.
 */

const FONT_DIR = path.join(process.cwd(), "src/server/pdf/fonts");
Font.register({
  family: "Plex",
  fonts: [
    { src: path.join(FONT_DIR, "IBMPlexSans-Regular.woff"), fontWeight: 400 },
    { src: path.join(FONT_DIR, "IBMPlexSans-Medium.woff"), fontWeight: 500 },
    { src: path.join(FONT_DIR, "IBMPlexSans-SemiBold.woff"), fontWeight: 600 },
  ],
});
Font.register({ family: "PlexMono", src: path.join(FONT_DIR, "IBMPlexMono-Regular.woff") });
Font.registerHyphenationCallback((word) => [word]);

const INK = "#15191F";
const INK2 = "#4A5260";
const INK3 = "#646C7A";
const LINE = "#E3E6EA";
const ACCENT = "#2B5B8A";
const TINT = "#EEF3F8";

const s = StyleSheet.create({
  // No page-level lineHeight: react-pdf then drops absolutely positioned fixed elements (the footer).
  page: { fontFamily: "Plex", fontSize: 8.5, color: INK, paddingTop: 40, paddingBottom: 48, paddingHorizontal: 44 },
  para: { lineHeight: 1.35 },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  company: { fontSize: 13, fontWeight: 600 },
  muted: { color: INK3 },
  ink2: { color: INK2 },
  title: { fontSize: 15, fontWeight: 600, color: ACCENT, textAlign: "right", letterSpacing: 0.5 },
  metaLabel: { color: INK3, width: 72 },
  rule: { borderBottomWidth: 0.75, borderBottomColor: LINE, marginVertical: 12 },
  h2: { fontSize: 10, fontWeight: 600, marginBottom: 6 },
  h3: { fontSize: 9, fontWeight: 600 },
  th: { fontSize: 7.5, color: INK3, fontWeight: 500 },
  cell: { paddingVertical: 3 },
  num: { textAlign: "right" },
  mono: { fontFamily: "PlexMono", fontSize: 8 },
  tableHead: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: LINE, paddingBottom: 3 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE },
  subtotal: { fontWeight: 600, borderTopWidth: 0.75, borderTopColor: INK3 },
  total: { fontWeight: 600, backgroundColor: TINT },
  footer: { position: "absolute", left: 44, right: 44, bottom: 22, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: INK3 },
  watermark: {
    position: "absolute",
    top: 360,
    left: 70,
    fontSize: 88,
    fontWeight: 600,
    color: "#D9DEE5",
    opacity: 0.45,
    transform: "rotate(-30deg)",
  },
});

const num2 = (v: string) => (v === "" ? "—" : formatNumber(v, 2).replace("-", "−"));

function Meta({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <View style={s.row}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={mono ? s.mono : undefined}>{value}</Text>
    </View>
  );
}

function PriceSummary({ doc }: { doc: QuoteDocument }) {
  const cols = { part: "34%", vol: "13%", unit: "13%", gst: "12%", incl: "13%", annual: "15%" };
  return (
    <View>
      <Text style={s.h2}>Prices</Text>
      <View style={s.tableHead} fixed>
        <Text style={[s.th, { width: cols.part }]}>Part</Text>
        <Text style={[s.th, s.num, { width: cols.vol }]}>Volume / year</Text>
        <Text style={[s.th, s.num, { width: cols.unit }]}>Unit price ₹</Text>
        <Text style={[s.th, s.num, { width: cols.gst }]}>GST ₹</Text>
        <Text style={[s.th, s.num, { width: cols.incl }]}>Incl. GST ₹</Text>
        <Text style={[s.th, s.num, { width: cols.annual }]}>Annual value ₹</Text>
      </View>
      {doc.parts.map((part) => (
        <View key={part.lineNo} wrap={false}>
          {part.tiers.map((t, i) => (
            <View key={t.volume} style={[s.tableRow, s.cell, t.isBase ? { backgroundColor: TINT } : {}]}>
              <View style={{ width: cols.part, paddingRight: 6 }}>
                {i === 0 ? (
                  <>
                    <Text style={{ fontWeight: 500 }}>
                      {part.lineNo}. {part.description}
                    </Text>
                    <Text style={[s.mono, s.muted]}>
                      {part.partNo} · GST {part.gstPct} %
                    </Text>
                  </>
                ) : null}
              </View>
              <Text style={[s.num, { width: cols.vol }]}>
                {formatInteger(t.volume)}
                {t.isBase ? "*" : ""}
              </Text>
              <Text style={[s.num, { width: cols.unit, fontWeight: 600 }]}>{num2(t.unitPrice)}</Text>
              <Text style={[s.num, { width: cols.gst }]}>{num2(t.gstAmount)}</Text>
              <Text style={[s.num, { width: cols.incl }]}>{num2(t.priceInclGst)}</Text>
              <Text style={[s.num, { width: cols.annual }]}>{num2(t.annualValue)}</Text>
            </View>
          ))}
        </View>
      ))}
      <Text style={[s.muted, { marginTop: 4 }]}>* Volume stated in your RFQ. GST is shown separately and is not part of the unit price.</Text>
    </View>
  );
}

function Breakup({ part }: { part: QuoteDocumentPart }) {
  const labelWidth = 40;
  const colWidth = (100 - labelWidth) / Math.max(part.tiers.length, 1);
  return (
    <View style={{ marginTop: 14 }} wrap={false}>
      <View style={s.between}>
        <Text style={s.h3}>
          {part.lineNo}. {part.description}
        </Text>
        <Text style={[s.mono, s.muted]}>{part.partNo}</Text>
      </View>
      <Text style={[s.ink2, { marginTop: 2 }]}>
        {[part.drawing && `Drawing ${part.drawing}`, part.material, `gross ${part.weights.grossKg} kg`, part.weights.forgedKg && `forged ${part.weights.forgedKg} kg`, `net ${part.weights.netKg} kg`, part.hsnCode && `HSN ${part.hsnCode}`]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      <Text style={[s.muted, { marginBottom: 5 }]}>RM basis: {part.rmBasis}</Text>
      <View style={s.tableHead}>
        <Text style={[s.th, { width: `${labelWidth}%` }]}>₹ per piece</Text>
        {part.tiers.map((t) => (
          <Text key={t.volume} style={[s.th, s.num, { width: `${colWidth}%` }]}>
            {formatInteger(t.volume)} / yr{t.isBase ? "*" : ""}
          </Text>
        ))}
      </View>
      {part.breakup.map((row) => (
        <View
          key={row.key}
          style={[s.tableRow, { paddingVertical: 2 }, row.emphasis === "subtotal" ? s.subtotal : {}, row.emphasis === "total" ? s.total : {}]}
        >
          <Text style={{ width: `${labelWidth}%`, paddingLeft: row.emphasis ? 0 : 6 }}>{row.label}</Text>
          {row.values.map((v, i) => (
            <Text key={i} style={[s.num, { width: `${colWidth}%` }]}>
              {num2(v)}
            </Text>
          ))}
        </View>
      ))}
      {part.tooling.mode === "AMORTIZED" ? (
        <Text style={[s.muted, { marginTop: 3 }]}>
          Tooling {formatINR(part.tooling.cost)} amortized over {part.tooling.amortYears} year(s) of volume and included above.
        </Text>
      ) : null}
    </View>
  );
}

function footerText(doc: QuoteDocument): string {
  const trace = doc.quote.shortHash ? `#${doc.quote.shortHash}` : "not yet frozen";
  return `${doc.quote.number} · Rev ${doc.quote.revision} · rates as of ${doc.quote.basisDate} · ${trace}`;
}

function QuotePdf({ doc }: { doc: QuoteDocument }) {
  const separate = doc.parts.filter((p) => p.tooling.mode === "SEPARATE" && Number(p.tooling.cost) > 0);
  return (
    <Document title={`${doc.quote.number} — ${doc.customer.name}`} author={doc.company.name} subject={doc.rfq.subject}>
      <Page size="A4" style={s.page}>
        {doc.watermark ? (
          <Text style={s.watermark} fixed>
            {doc.watermark}
          </Text>
        ) : null}
        <View style={s.footer} fixed>
          <Text>{footerText(doc)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        <View style={s.between}>
          <View>
            <Text style={s.company}>{doc.company.name}</Text>
            {doc.company.addressLines.map((l) => (
              <Text key={l} style={s.ink2}>
                {l}
              </Text>
            ))}
            <Text style={s.muted}>GSTIN {doc.company.gstin}</Text>
            <Text style={s.muted}>
              {doc.company.email} · {doc.company.phone}
            </Text>
          </View>
          <View>
            <Text style={s.title}>QUOTATION</Text>
            <Text style={[s.mono, { textAlign: "right", marginTop: 2 }]}>{doc.quote.number}</Text>
            <Text style={[s.ink2, { textAlign: "right" }]}>{doc.quote.date}</Text>
          </View>
        </View>

        <View style={s.rule} />

        <View style={s.between}>
          <View style={{ width: "48%" }}>
            <Text style={[s.th, { marginBottom: 2 }]}>TO</Text>
            <Text style={{ fontWeight: 600 }}>{doc.customer.name}</Text>
            {doc.customer.addressLines.map((l) => (
              <Text key={l} style={s.ink2}>
                {l}
              </Text>
            ))}
            {doc.customer.contactName ? <Text style={s.ink2}>Attn: {doc.customer.contactName}</Text> : null}
            {doc.customer.contactEmail ? <Text style={s.muted}>{doc.customer.contactEmail}</Text> : null}
          </View>
          <View style={{ width: "48%" }}>
            <Meta label="Your RFQ" value={doc.customer.customerRef} mono />
            <Meta label="Our reference" value={doc.rfq.number} mono />
            <Meta label="Subject" value={doc.rfq.subject} />
            <Meta label="Revision" value={String(doc.quote.revision)} />
            <Meta label="Valid until" value={doc.quote.validUntil} />
            <Meta label="Rates as of" value={doc.quote.basisDate} />
          </View>
        </View>

        <View style={s.rule} />
        <PriceSummary doc={doc} />

        <View style={s.rule} />
        <Text style={s.h2}>Cost breakup</Text>
        {doc.parts.map((p) => (
          <Breakup key={p.lineNo} part={p} />
        ))}

        {separate.length ? (
          <View wrap={false} style={{ marginTop: 14 }}>
            <Text style={s.h2}>One-time tooling (charged separately)</Text>
            {separate.map((p) => (
              <View key={p.lineNo} style={[s.tableRow, s.cell]}>
                <Text style={{ width: "70%" }}>
                  {p.description} — {p.tooling.note ?? "dies and fixtures"}
                </Text>
                <Text style={[s.num, { width: "30%" }]}>{formatINR(p.tooling.cost)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View wrap={false} style={{ marginTop: 16 }}>
          <Text style={s.h2}>Terms</Text>
          {doc.terms.map((t, i) => (
            <View key={i} style={[s.row, { marginBottom: 2 }]}>
              <Text style={[s.muted, { width: 12 }]}>{i + 1}.</Text>
              <Text style={[s.ink2, s.para, { flex: 1 }]}>{t}</Text>
            </View>
          ))}
        </View>

        <View wrap={false} style={{ marginTop: 16 }}>
          <Text style={s.h2}>Rate basis</Text>
          <Text style={[s.muted, { marginBottom: 4 }]}>Every rate this quote was priced with, exactly as recorded in the rate masters.</Text>
          <View style={s.tableHead}>
            <Text style={[s.th, { width: "22%" }]}>Code</Text>
            <Text style={[s.th, { width: "44%" }]}>Rate</Text>
            <Text style={[s.th, s.num, { width: "17%" }]}>Value</Text>
            <Text style={[s.th, s.num, { width: "17%" }]}>Effective from</Text>
          </View>
          {doc.rateBasis.map((r) => (
            <View key={r.code + r.effectiveFrom} style={[s.tableRow, { paddingVertical: 2 }]}>
              <Text style={[s.mono, { width: "22%" }]}>{r.code}</Text>
              <Text style={{ width: "44%" }}>{r.name}</Text>
              <Text style={[s.num, { width: "17%" }]}>{r.value}</Text>
              <Text style={[s.num, { width: "17%" }]}>{r.effectiveFrom}</Text>
            </View>
          ))}
        </View>

        <View wrap={false} style={[s.between, { marginTop: 22 }]}>
          <View style={{ width: "45%" }}>
            <Text style={s.th}>PREPARED BY</Text>
            <Text style={{ marginTop: 3 }}>{doc.signatures.preparedBy}</Text>
          </View>
          <View style={{ width: "45%" }}>
            <Text style={s.th}>APPROVED BY</Text>
            <Text style={{ marginTop: 3 }}>
              {doc.signatures.approvedBy ?? (doc.signatures.approvalNote ? "Approved by rule" : "Pending approval")}
              {doc.signatures.approvedOn ? ` · ${doc.signatures.approvedOn}` : ""}
            </Text>
            {doc.signatures.approvalNote ? <Text style={s.muted}>{doc.signatures.approvalNote}</Text> : null}
          </View>
        </View>

      </Page>
    </Document>
  );
}

export async function renderQuotePdf(doc: QuoteDocument): Promise<Buffer> {
  return renderToBuffer(<QuotePdf doc={doc} />);
}
