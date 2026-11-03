import type { IsoDate } from "../calendar";
import { checkPlausible, evidenceSupports, isGrounded, rateConfidence, type Mode } from "./confidence";
import { FIELD_BY_KEY } from "./fields";
import type { Candidate, SourceKind } from "./merge";
import { matchMaterial, parseAnnualVolume, parseDate, parseWeightKg, type MaterialOption } from "./normalize";

/**
 * One code path from "what a source said" to a scored Candidate, shared by the AI extractor, the
 * rule-based fallback and the Excel parser: normalize → check it against its evidence → check
 * plausibility and the master → rate confidence.
 */

export interface RawValue {
  fieldKey: string;
  /** The value as written or as the model returned it. */
  raw: string;
  /** Verbatim snippet the value was read from (null when the extractor gave none). */
  evidence: string | null;
  locator: string | null;
  part?: Candidate["part"];
  column?: Candidate["column"];
}

export interface SourceInfo {
  id: string;
  kind: SourceKind;
  label: string;
  /** Full text the evidence must appear in (empty for parsed cells, which are their own evidence). */
  text: string;
  mode: Mode;
}

export interface ReadContext {
  materials: MaterialOption[];
  receivedDate?: IsoDate;
}

export function toCandidate(raw: RawValue, source: SourceInfo, ctx: ReadContext): Candidate | null {
  const spec = FIELD_BY_KEY.get(raw.fieldKey);
  const text = raw.raw.trim();
  if (!spec || !text) return null;

  let value: string;
  let display: string;
  const notes: string[] = [];
  let inMaster: boolean | null = null;

  switch (spec.type) {
    case "weightKg": {
      const p = parseWeightKg(text);
      if (!p) return null;
      value = p.value;
      display = `${Number(p.value)} kg`;
      notes.push(...p.notes);
      break;
    }
    case "volume": {
      const p = parseAnnualVolume(text);
      if (!p) return null;
      value = String(p.value);
      display = `${p.value.toLocaleString("en-IN")} / yr`;
      notes.push(...p.notes.filter((n) => /×/.test(n)));
      break;
    }
    case "date": {
      const p = parseDate(text);
      if (!p) return null;
      value = p.value;
      display = p.value;
      notes.push(...p.notes);
      break;
    }
    case "material": {
      const m = matchMaterial(text, ctx.materials);
      value = m ? m.grade : text;
      display = m && m.grade !== text ? `${m.grade} (written “${text}”)` : value;
      inMaster = Boolean(m);
      if (m?.via === "alias") notes.push(`“${text}” is an alias of ${m.grade}`);
      break;
    }
    case "email":
      value = text.toLowerCase().replace(/^.*<|>.*$/g, "");
      display = value;
      break;
    default:
      value = text.replace(/\s+/g, " ");
      display = value;
  }

  const evidence = raw.evidence?.trim() || null;
  const grounded =
    source.mode === "PARSER" ||
    (evidence !== null && isGrounded(evidence, source.text) && (spec.type === "material" || evidenceSupports(spec.type, value, evidence)));
  const plausible = checkPlausible(spec.type, value, { receivedDate: ctx.receivedDate });
  const { confidence, reason } = rateConfidence({ mode: source.mode, fromImage: source.kind === "DRAWING_IMAGE", grounded, notes, plausible, inMaster });

  return {
    fieldKey: raw.fieldKey,
    part: raw.part,
    value,
    display,
    sourceId: source.id,
    sourceKind: source.kind,
    sourceLabel: source.label,
    locator: raw.locator,
    evidence,
    mode: source.mode,
    grounded,
    confidence,
    reason,
    column: raw.column,
  };
}
