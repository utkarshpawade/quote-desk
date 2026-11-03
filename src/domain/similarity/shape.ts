import { normalizeText } from "../text";

/**
 * Coarse part classification used to decide whether a past part's routing can sensibly be
 * reused. Routing follows the input form (bar-turned vs forged) and the shape family far more
 * than the steel grade, which drives price, not process (DESIGN.md §5.5).
 */

export type ShapeFamily = "shaft" | "disc" | "arm" | "housing" | "other";
export type InputForm = "BAR" | "FORGING";

const FAMILY_WORDS: Array<[ShapeFamily, string[]]> = [
  ["shaft", ["spindle", "axle", "shaft", "pin", "stud", "bolt", "rod", "king pin"]],
  ["disc", ["blank", "hub", "flange", "ring", "gear", "disc", "disk", "bush", "collar", "sprocket", "pulley"]],
  ["arm", ["arm", "lever", "yoke", "bracket", "link", "fork", "knuckle", "crank"]],
  ["housing", ["housing", "body", "cover", "case", "casing", "carrier"]],
];

export function shapeFamily(description: string): ShapeFamily {
  const words = ` ${normalizeText(description)} `;
  for (const [family, keys] of FAMILY_WORDS) {
    if (keys.some((k) => words.includes(` ${k} `) || words.includes(` ${k}s `))) return family;
  }
  return "other";
}

export function inputForm(args: { materialText?: string | null; description?: string | null; hasForgedWeight?: boolean }): InputForm {
  if (args.hasForgedWeight) return "FORGING";
  const text = normalizeText(`${args.materialText ?? ""} ${args.description ?? ""}`);
  return /\bforg(ed|ing)\b/.test(text) ? "FORGING" : "BAR";
}
