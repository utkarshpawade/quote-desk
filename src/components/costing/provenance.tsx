import { formatDateTime } from "@/lib/format";
import type { ProvenanceView } from "@/server/services/quotes";

const SOURCE: Record<string, string> = {
  EMAIL: "Email",
  PASTED_TEXT: "Pasted text",
  EXCEL: "Excel",
  DRAWING_PDF: "Drawing",
  DRAWING_IMAGE: "Drawing image",
};

/**
 * Where a pre-filled value came from, shown quietly under the field: "Excel E4", or
 * "Edited · was 0.61 (Excel E4)" once the estimator changed it. Details on hover/focus.
 */
export function ProvenanceCaption({ provenance, current }: { provenance: ProvenanceView | undefined; current: string | null }) {
  if (!provenance) return null;
  const where = `${SOURCE[provenance.sourceKind] ?? provenance.sourceKind}${provenance.locator ? ` ${provenance.locator.replace(/^Sheet\d*!/, "")}` : ""}`;
  const same = current !== null && Number.isFinite(Number(current)) && Number.isFinite(Number(provenance.value)) ? Number(current) === Number(provenance.value) : current === provenance.value;
  const title = [
    `${provenance.sourceLabel}${provenance.locator ? ` · ${provenance.locator}` : ""}`,
    provenance.evidence ? `“${provenance.evidence}”` : null,
    `Accepted by ${provenance.acceptedBy}, ${formatDateTime(provenance.acceptedAt)} (${provenance.decidedVia.toLowerCase()})`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className="block truncate text-xs text-ink-3" title={title} tabIndex={0}>
      {same ? where : `Edited · was ${provenance.value} (${where})`}
    </span>
  );
}
