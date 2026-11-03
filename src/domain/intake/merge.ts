import { normalizeText, trigramDice } from "../text";
import type { Confidence, Mode } from "./confidence";
import { FIELD_BY_KEY, fieldOrder } from "./fields";

/**
 * Merges what each source said into one proposal per field. Sources that agree reinforce each
 * other; sources that disagree become a conflict the estimator resolves — never auto-picked.
 * An AI value that could not be found in its source is kept for reference but not pre-filled.
 */

export type SourceKind = "EMAIL" | "PASTED_TEXT" | "EXCEL" | "DRAWING_PDF" | "DRAWING_IMAGE";

export interface Candidate {
  fieldKey: string;
  /** For part-level fields: what identifies the part in this source. */
  part?: { partNo?: string | null; description?: string | null; row?: number };
  value: string;
  /** How to show it ("0.61 kg", "1,80,000 / yr"). */
  display: string;
  sourceId: string;
  sourceKind: SourceKind;
  sourceLabel: string;
  locator: string | null;
  evidence: string | null;
  mode: Mode;
  grounded: boolean;
  confidence: Confidence;
  reason: string;
  /** Excel: the column it came from, so the estimator can confirm a whole column once. */
  column?: { letter: string; header: string };
}

export interface Proposal {
  partKey: string;
  partLabel: string | null;
  fieldKey: string;
  proposedValue: string | null;
  confidence: Confidence;
  reason: string;
  conflict: boolean;
  /** ≥ 2 grounded sources agree — eligible for the per-part "accept matching" action. */
  agreed: boolean;
  candidates: Candidate[];
  sortOrder: number;
}

const RANK: Record<Confidence, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function comparable(fieldKey: string, value: string): string {
  const type = FIELD_BY_KEY.get(fieldKey)?.type;
  if (type === "weightKg" || type === "volume") return String(Number(value));
  return normalizeText(value).replace(/\s/g, "");
}

/** Part numbers compare without case, spaces or punctuation: "CB RWS 0612" = "CB-RWS-0612". */
export const partNoKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Part key for values that could not be tied to a part. */
export const UNMATCHED = "UNMATCHED";

/**
 * Gives every part-level candidate a stable part key: the normalized part number when one is
 * known, otherwise a description that matches an existing part (trigram ≥ 0.6), otherwise new.
 */
export function assignParts(candidates: Candidate[]): Array<Candidate & { partKey: string }> {
  const parts: Array<{ key: string; partNo: string | null; description: string | null }> = [];
  // Rows/sources first teach us which part numbers exist, so description-only hits can join them.
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (FIELD_BY_KEY.get(c.fieldKey)?.level !== "part") continue;
    const groupKey = `${c.sourceId}|${c.part?.row ?? c.part?.partNo ?? c.part?.description ?? "_"}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), c]);
  }
  const keyForGroup = new Map<string, string>();
  const anonymous: string[] = [];
  const identify = (list: Candidate[]) => ({
    partNo: list.find((c) => c.fieldKey === "partNo")?.value ?? list.find((c) => c.part?.partNo)?.part?.partNo ?? null,
    description: list.find((c) => c.fieldKey === "description")?.value ?? list.find((c) => c.part?.description)?.part?.description ?? null,
  });
  // Groups that name a part number go first, whatever order the sources arrived in, so a
  // description-only group (a title block without a part no.) can join the part it describes.
  const ordered = [...groups].map(([groupKey, list]) => ({ groupKey, ...identify(list) })).sort((a, b) => Number(!a.partNo) - Number(!b.partNo));
  for (const { groupKey, partNo, description } of ordered) {
    if (!partNo && !description) {
      anonymous.push(groupKey);
      continue;
    }
    let match = partNo ? parts.find((p) => p.partNo && partNoKey(p.partNo) === partNoKey(partNo)) : undefined;
    if (!match && description) match = parts.find((p) => p.description && trigramDice(p.description, description) >= 0.6 && (!partNo || !p.partNo));
    if (!match) {
      match = { key: partNo ? partNoKey(partNo) : `PART-${parts.length + 1}`, partNo, description };
      parts.push(match);
    } else {
      match.partNo ??= partNo;
      match.description ??= description;
    }
    keyForGroup.set(groupKey, match.key);
  }
  // Values that name no part (e.g. "Annual requirement: 60,000 nos") belong to the only part when
  // there is one; with several parts they are shown apart for the estimator to place or reject.
  for (const groupKey of anonymous) keyForGroup.set(groupKey, parts.length === 1 ? parts[0]!.key : UNMATCHED);
  return candidates.map((c) => {
    if (FIELD_BY_KEY.get(c.fieldKey)?.level !== "part") return { ...c, partKey: "" };
    const groupKey = `${c.sourceId}|${c.part?.row ?? c.part?.partNo ?? c.part?.description ?? "_"}`;
    return { ...c, partKey: keyForGroup.get(groupKey) ?? UNMATCHED };
  });
}

export function mergeCandidates(input: Candidate[]): Proposal[] {
  const assigned = assignParts(input);
  const byField = new Map<string, Array<Candidate & { partKey: string }>>();
  for (const c of assigned) {
    const key = `${c.partKey}::${c.fieldKey}`;
    byField.set(key, [...(byField.get(key) ?? []), c]);
  }
  // Each part is headed by its most confident description ("Gear blank" from the cell rather
  // than "GEAR BLANK" read from the title block).
  const labels = new Map<string, { value: string; rank: number }>();
  for (const c of assigned) {
    if (!c.partKey || c.fieldKey !== "description" || !c.grounded) continue;
    const current = labels.get(c.partKey);
    if (!current || RANK[c.confidence] > current.rank) labels.set(c.partKey, { value: c.value, rank: RANK[c.confidence] });
  }

  const proposals: Proposal[] = [];
  for (const [key, list] of byField) {
    const [partKey, fieldKey] = key.split("::") as [string, string];
    const grounded = list.filter((c) => c.grounded);
    const distinct = new Map<string, Candidate[]>();
    for (const c of grounded) {
      const k = comparable(fieldKey, c.value);
      distinct.set(k, [...(distinct.get(k) ?? []), c]);
    }
    const sorted = [...list].sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
    const partLabel = !partKey ? null : partKey === UNMATCHED ? "Values not matched to a part" : (labels.get(partKey)?.value ?? partKey);
    const base = { partKey, partLabel, fieldKey, candidates: sorted, sortOrder: fieldOrder(fieldKey) };

    if (distinct.size > 1) {
      const variants = [...distinct.values()].map((cs) => `${cs[0]!.display} (${cs.map((c) => c.sourceLabel).join(", ")})`);
      proposals.push({ ...base, proposedValue: null, confidence: "LOW", reason: `sources disagree: ${variants.join(" vs ")}`, conflict: true, agreed: false });
      continue;
    }
    if (distinct.size === 0) {
      const best = sorted[0]!;
      proposals.push({ ...base, proposedValue: null, confidence: "LOW", reason: `AI read ${best.display} — not found in the source`, conflict: false, agreed: false });
      continue;
    }
    const [agreeing] = [...distinct.values()] as [Candidate[]];
    const best = [...agreeing].sort((a, b) => RANK[b.confidence] - RANK[a.confidence])[0]!;
    const sources = new Set(agreeing.map((c) => c.sourceId));
    const agreed = sources.size >= 2;
    const confidence: Confidence = agreed && best.confidence === "MEDIUM" ? "HIGH" : best.confidence;
    const reason = agreed ? `${sources.size} sources agree${best.confidence === "MEDIUM" ? ` (${best.reason})` : ""}` : best.reason;
    proposals.push({ ...base, proposedValue: best.value, confidence, reason, conflict: false, agreed });
  }
  return proposals.sort((a, b) => a.partKey.localeCompare(b.partKey) || a.sortOrder - b.sortOrder);
}
