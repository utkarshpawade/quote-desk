import type { IsoDate } from "../calendar";
import { trigramDice } from "../text";
import type { InputForm, ShapeFamily } from "./shape";

/**
 * Finds past parts like the one being costed (DESIGN.md §5.5). Deterministic and explainable:
 * a gate decides whether two parts are comparable at all, then a weighted score ranks them, and
 * every component is shown to the estimator. Weights and threshold are starting values (A-26).
 */

export interface PartProfile {
  description: string;
  inputForm: InputForm | null;
  shapeFamily: ShapeFamily | null;
  materialGrade: string | null;
  materialFamily: string | null;
  /** Gross weight, or net when gross is unknown. */
  weightKg: number | null;
}

export interface Target extends PartProfile {
  /** Processes named on the drawing ("induction hardening"). */
  processHints: string[];
}

export interface Comparable extends PartProfile {
  quoteDate: IsoDate;
  /** Process cues its routing covers, in the drawing-hint vocabulary (processHints of the op names). */
  processes: string[];
}

export const WEIGHTS = { name: 0.35, family: 0.2, material: 0.15, weight: 0.15, process: 0.1, recency: 0.05 } as const;
export type Component = keyof typeof WEIGHTS;
export const THRESHOLD = 0.55;

export interface Match {
  score: number;
  /** Each component's 0–1 value; null when there was nothing to compare (left out of the score). */
  components: Record<Component, number | null>;
}

const monthsBetween = (a: IsoDate, b: IsoDate) => (Date.parse(b) - Date.parse(a)) / (30.44 * 86_400_000);

/** Comparable only when made the same way: same input form, and a similar name or shape. */
export function passesGate(target: PartProfile, past: PartProfile): boolean {
  if (!target.inputForm || !past.inputForm || target.inputForm !== past.inputForm) return false;
  const sameFamily = target.shapeFamily !== null && target.shapeFamily !== "other" && target.shapeFamily === past.shapeFamily;
  return sameFamily || trigramDice(target.description, past.description) >= 0.5;
}

export function scoreMatch(target: Target, past: Comparable, today: IsoDate): Match {
  const components: Record<Component, number | null> = {
    name: trigramDice(target.description, past.description),
    family: target.shapeFamily && target.shapeFamily !== "other" ? (target.shapeFamily === past.shapeFamily ? 1 : 0) : null,
    material: !target.materialGrade
      ? null
      : target.materialGrade === past.materialGrade
        ? 1
        : target.materialFamily && target.materialFamily === past.materialFamily
          ? 0.6
          : 0,
    weight:
      target.weightKg && past.weightKg
        ? Math.max(0, 1 - Math.abs(target.weightKg - past.weightKg) / Math.max(target.weightKg, past.weightKg))
        : null,
    process: target.processHints.length
      ? target.processHints.filter((h) => past.processes.includes(h)).length / target.processHints.length
      : null,
    recency: Math.min(1, Math.max(0, (48 - monthsBetween(past.quoteDate, today)) / 24)),
  };
  // Missing information neither helps nor hurts: the score is renormalized over what is known.
  let total = 0;
  let weight = 0;
  for (const [key, value] of Object.entries(components) as Array<[Component, number | null]>) {
    if (value === null) continue;
    total += WEIGHTS[key] * value;
    weight += WEIGHTS[key];
  }
  return { score: weight ? Math.round((total / weight) * 1000) / 1000 : 0, components };
}

/** Gate, score, keep those at or above the threshold, best first (newer first on ties). */
export function rankSimilar<T extends Comparable>(target: Target, candidates: T[], today: IsoDate, limit = 5): Array<T & { match: Match }> {
  return candidates
    .filter((c) => passesGate(target, c))
    .map((c) => ({ ...c, match: scoreMatch(target, c, today) }))
    .filter((c) => c.match.score >= THRESHOLD)
    .sort((a, b) => b.match.score - a.match.score || b.quoteDate.localeCompare(a.quoteDate))
    .slice(0, limit);
}

export const COMPONENT_LABEL: Record<Component, string> = {
  name: "Name",
  family: "Shape",
  material: "Material",
  weight: "Weight",
  process: "Processes",
  recency: "Recency",
};

/** Median of a list of numbers (null when empty). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
