/**
 * Text helpers shared by intake (matching parts across sources) and past-quote similarity.
 * Trigrams follow pg_trgm's convention (each word padded with two leading and one trailing
 * space) so in-app scores line up with what Postgres `similarity()` pre-filters on.
 */

/** Lower-case, letters and digits only, single spaces. "Rear Wheel-Spindle (LH)" → "rear wheel spindle lh". */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of normalizeText(text).split(" ")) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Dice coefficient over trigram sets, 0…1. */
export function trigramDice(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const g of ta) if (tb.has(g)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}
