/**
 * The values intake looks for. RFQ-level fields describe the enquiry; part-level fields become
 * the RfqPart. `priceDriving` fields move the quote's price and are never bulk-accepted from a
 * single source.
 */

export type FieldType = "text" | "date" | "weightKg" | "volume" | "material" | "email";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  level: "rfq" | "part";
  required?: boolean;
  priceDriving?: boolean;
}

export const FIELDS: FieldSpec[] = [
  { key: "customerName", label: "Customer", type: "text", level: "rfq", required: true },
  { key: "contactEmail", label: "Contact email", type: "email", level: "rfq" },
  { key: "customerRef", label: "Customer RFQ no.", type: "text", level: "rfq" },
  { key: "subject", label: "Subject", type: "text", level: "rfq" },
  { key: "receivedDate", label: "Received", type: "date", level: "rfq" },
  { key: "dueDate", label: "Quote due", type: "date", level: "rfq", required: true },
  { key: "partNo", label: "Part no.", type: "text", level: "part" },
  { key: "description", label: "Description", type: "text", level: "part", required: true },
  { key: "drawingNo", label: "Drawing no.", type: "text", level: "part" },
  { key: "drawingRev", label: "Drawing rev", type: "text", level: "part" },
  { key: "material", label: "Material", type: "material", level: "part", priceDriving: true },
  { key: "grossWeightKg", label: "Gross weight", type: "weightKg", level: "part", priceDriving: true },
  { key: "netWeightKg", label: "Net (finished) weight", type: "weightKg", level: "part", priceDriving: true },
  { key: "annualVolume", label: "Annual volume", type: "volume", level: "part", required: true, priceDriving: true },
  { key: "heatTreatment", label: "Heat treatment", type: "text", level: "part" },
  { key: "surfaceTreatment", label: "Surface treatment", type: "text", level: "part" },
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export function fieldOrder(key: string): number {
  const i = FIELDS.findIndex((f) => f.key === key);
  return i < 0 ? FIELDS.length : i;
}
