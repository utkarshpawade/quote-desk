/**
 * Process cues in drawing notes, found locally with a keyword dictionary — the notes never leave
 * the system (NDA). Used to flag a process the routing does not cover and to rank similar parts.
 */
const HINTS: Array<[string, RegExp]> = [
  ["induction hardening", /\binduction\s*harden/i],
  ["case carburising", /\bcarburi[sz]/i],
  ["hardening & tempering", /\bharden(ed|ing)?\s*(and|&)\s*temper|\bH\s*&\s*T\b|\bQ\s*&\s*T\b/i],
  ["normalising", /\bnormali[sz]/i],
  ["isothermal annealing", /\bisothermal|\banneal/i],
  ["thread rolling", /\bthread\s*roll/i],
  ["cylindrical grinding", /\bgrind/i],
  ["zinc plating", /\bzinc|\bplat(ed|ing)\b/i],
  ["phosphating", /\bphosphat/i],
  ["MPI crack detection", /\bMPI\b|\bmagnetic particle|\bcrack[- ]?(free|detection|test)/i],
  ["shot blasting", /\bshot\s*blast/i],
  ["broaching", /\bbroach/i],
  ["gear hobbing", /\bhob(bing|bed)?\b|\bspline/i],
  ["drilling & tapping", /\btap(ped|ping)?\b|\bdrill/i],
];

export function processHints(text: string): string[] {
  return HINTS.filter(([, re]) => re.test(text)).map(([hint]) => hint);
}
