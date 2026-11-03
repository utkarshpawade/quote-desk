import type { RawValue } from "./read";

/**
 * Rule-based reading of an RFQ email or a drawing title block — the fallback when AI is
 * unavailable or not allowed under the customer's NDA. It only recognises labelled values
 * ("Material: …", "PART NO …"), so it misses more than the model but never invents anything.
 */

const DATE = String.raw`(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}[\s,.-]+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})`;
const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?\s*(?:lakhs?|lacs?|lac|l|k|crores?|cr)?\b(?:\s*(?:nos|pcs|numbers|units))?(?:\s*(?:per|\/|p\.)\s*(?:annum|year|yr|month|week|a\.|m\.))?)`;
const WEIGHT = String.raw`(\d[\d,]*(?:[.,]\d+)?\s*(?:kgs?|kilograms?|grams?|gms?|g)\b)`;

type Rule = { fieldKey: string; re: RegExp; level: "rfq" | "part" };

const EMAIL_RULES: Rule[] = [
  { fieldKey: "customerRef", re: /\b(?:RFQ|Enquiry|Inquiry|Our ref(?:erence)?|Ref(?:erence)?)\s*(?:No\.?|Number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9/\-_.]{3,})/i, level: "rfq" },
  { fieldKey: "dueDate", re: new RegExp(String.raw`\b(?:due(?: date)?|last date|on or before|before|latest by|submit(?:ted)?(?: your (?:quote|offer))?(?: by| before)?|quote by)\s*(?:on)?\s*[:\-]?\s*${DATE}`, "i"), level: "rfq" },
  { fieldKey: "annualVolume", re: new RegExp(String.raw`\b(?:annual (?:volume|requirement|qty|quantity)|EAU|estimated annual usage|volume|requirement|monthly (?:schedule|requirement))\s*(?:of|is|:|-)?\s*${NUMBER}`, "i"), level: "part" },
  { fieldKey: "material", re: /\b(?:Material|Matl\.?|Grade)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9 \-/.]{1,40}?)(?:\s+as per|\s*$|[,;])/i, level: "part" },
  { fieldKey: "partNo", re: /\b(?:Part|Item)\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/.]{3,})/i, level: "part" },
  { fieldKey: "drawingNo", re: /\b(?:Drg\.?|Drawing)\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/.]{3,})/i, level: "part" },
  { fieldKey: "grossWeightKg", re: new RegExp(String.raw`\b(?:gross|input|forging|cut)\s*(?:wt\.?|weight)\s*[:\-]?\s*${WEIGHT}`, "i"), level: "part" },
  { fieldKey: "netWeightKg", re: new RegExp(String.raw`\b(?:net|finish(?:ed)?)\s*(?:wt\.?|weight)\s*[:\-]?\s*${WEIGHT}`, "i"), level: "part" },
];

const TITLE_BLOCK_RULES: Rule[] = [
  { fieldKey: "description", re: /\b(?:PART NAME|TITLE|DESCRIPTION)\s*[:\-]?\s*([A-Z][A-Z0-9 \-/&]{2,40})/i, level: "part" },
  { fieldKey: "partNo", re: /\bPART\s*NO\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/.]{3,})/i, level: "part" },
  { fieldKey: "drawingNo", re: /\b(?:DRG|DRAWING)\s*NO\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/.]{3,})/i, level: "part" },
  { fieldKey: "drawingRev", re: /\bREV(?:ISION)?\.?\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i, level: "part" },
  { fieldKey: "material", re: /\bMATERIAL\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9 \-/.]{1,30}?)(?:\s{2,}|\s*$|,)/i, level: "part" },
  { fieldKey: "netWeightKg", re: new RegExp(String.raw`\b(?:FINISH(?:ED)?\s*)?(?:WT|WEIGHT)\.?\s*(?:\(FINISHED\))?\s*[:\-]?\s*${WEIGHT}`, "i"), level: "part" },
  { fieldKey: "heatTreatment", re: /\b(?:HT|HEAT TREATMENT)\s*[:\-]\s*([A-Z0-9][A-Z0-9 \-&]{3,40})/i, level: "part" },
  { fieldKey: "surfaceTreatment", re: /\b(?:FINISH|SURFACE (?:TREATMENT|FINISH))\s*[:\-]\s*([A-Z][A-Z0-9 \-&]{3,40})/i, level: "part" },
];

/** Reads labelled values line by line; `lineLocator` turns a 0-based index into "line 12". */
export function readByRules(text: string, kind: "EMAIL" | "TITLE_BLOCK"): RawValue[] {
  const rules = kind === "EMAIL" ? EMAIL_RULES : TITLE_BLOCK_RULES;
  const lines = text.split(/\r?\n/);
  const out: RawValue[] = [];
  const seen = new Set<string>();
  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/^L\d{3}:\s?/, "");
    for (const rule of rules) {
      if (seen.has(rule.fieldKey)) continue;
      const m = rule.re.exec(line);
      if (!m?.[1]) continue;
      seen.add(rule.fieldKey);
      out.push({
        fieldKey: rule.fieldKey,
        raw: m[1].trim(),
        evidence: line.trim(),
        locator: kind === "EMAIL" ? `line ${index + 1}` : "title block",
        part: rule.level === "part" ? {} : undefined,
      });
    }
  });
  return out;
}
