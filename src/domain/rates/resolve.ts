import { addDays, type IsoDate } from "../calendar";
import { dec, type DecimalString } from "../money";

/**
 * Rate versioning (DESIGN.md §4). Versions are append-only; a correction voids one version and
 * adds another. The invariant that keeps every quote traceable:
 *
 *   No new or voided version may change the rate resolved for any frozen quote
 *   (submitted, approved or sent).
 */

export interface VersionLike {
  id: string;
  effectiveFrom: IsoDate;
  value: DecimalString;
  voidedAt: string | null;
}

export function liveVersions<T extends VersionLike>(versions: T[]): T[] {
  return versions.filter((v) => v.voidedAt === null).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** The version in force on `date`: the latest live version starting on or before it. */
export function resolveAt<T extends VersionLike>(versions: T[], date: IsoDate): T | null {
  let found: T | null = null;
  for (const v of liveVersions(versions)) {
    if (v.effectiveFrom <= date) found = v;
    else break;
  }
  return found;
}

/** Each live version with the last day it is in force (null = open-ended). */
export function liveWindows<T extends VersionLike>(versions: T[]): Array<{ version: T; effectiveTo: IsoDate | null }> {
  const live = liveVersions(versions);
  return live.map((version, i) => {
    const next = live[i + 1];
    return { version, effectiveTo: next ? addDays(next.effectiveFrom, -1) : null };
  });
}

export type Check = { ok: true } | { ok: false; reason: string };

/**
 * May a new version start on `effectiveFrom`? It would govern [effectiveFrom, next live version),
 * so it is refused when a frozen quote priced on a basis date inside that window.
 * Future-dated versions are always allowed (basis dates are never in the future).
 */
export function checkNewVersion(args: {
  versions: VersionLike[];
  effectiveFrom: IsoDate;
  today: IsoDate;
  /** Basis dates of frozen quotes that use this rate item. */
  frozenBasisDates: IsoDate[];
}): Check {
  const { versions, effectiveFrom, frozenBasisDates } = args;
  const live = liveVersions(versions);
  if (live.some((v) => v.effectiveFrom === effectiveFrom)) {
    return { ok: false, reason: "A live version already starts on this date. Void it first to correct it." };
  }
  const next = live.find((v) => v.effectiveFrom > effectiveFrom);
  const affected = frozenBasisDates.filter((d) => d >= effectiveFrom && (!next || d < next.effectiveFrom));
  if (affected.length > 0) {
    const latest = affected.sort().at(-1)!;
    return {
      ok: false,
      reason: `${affected.length} submitted or sent quote${affected.length > 1 ? "s were" : " was"} priced on this rate on or after this date (latest basis ${latest}). Choose a date after ${latest}.`,
    };
  }
  return { ok: true };
}

/** A version referenced by a frozen quote can never be voided; drafts are re-pointed instead. */
export function checkVoid(args: { version: VersionLike; frozenVersionIds: ReadonlySet<string> }): Check {
  if (args.version.voidedAt !== null) return { ok: false, reason: "This version is already void." };
  if (args.frozenVersionIds.has(args.version.id)) {
    return { ok: false, reason: "A submitted or sent quote uses this version, so it cannot be voided." };
  }
  return { ok: true };
}

/** Relative change from the previous value, e.g. 0.034 for +3.4 %. */
export function changeRatio(previous: DecimalString, next: DecimalString): number {
  const prev = dec(previous);
  if (prev.isZero()) return Number.POSITIVE_INFINITY;
  return dec(next).minus(prev).dividedBy(prev).toNumber();
}

/** Typo guard: a change of more than 20 % must be confirmed (72.50 → 725.00 is caught). */
export function needsConfirmation(previous: DecimalString | null, next: DecimalString): boolean {
  return previous !== null && Math.abs(changeRatio(previous, next)) > 0.2;
}
