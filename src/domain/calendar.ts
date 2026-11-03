/**
 * Working-day arithmetic for due dates and turnaround (A-11: Sundays are off; no holiday
 * calendar). All functions work on calendar dates in India time, expressed as "YYYY-MM-DD".
 */

export type IsoDate = string; // "2026-11-03"

const IST_OFFSET_MINUTES = 330;

/** Calendar date in India for an instant. Servers run in UTC; business dates never do. */
export function toIstDate(instant: Date): IsoDate {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Today's date in India — the only "today" business logic may use. */
export function todayIst(now: Date = new Date()): IsoDate {
  return toIstDate(now);
}

/** A Postgres DATE column (read by Prisma as UTC midnight) as "YYYY-MM-DD". */
export function fromDbDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → the Date Prisma expects for a DATE column. */
export function toDbDate(date: IsoDate): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date "${date}"`);
  return new Date(`${date}T00:00:00.000Z`);
}

function parse(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

export function isWorkingDay(date: IsoDate): boolean {
  return parse(date).getUTCDay() !== 0; // Sunday
}

/** Adds `days` working days (skipping Sundays). Adding 0 returns the date itself. */
export function addWorkingDays(date: IsoDate, days: number): IsoDate {
  let current = date;
  let remaining = days;
  while (remaining > 0) {
    current = addDays(current, 1);
    if (isWorkingDay(current)) remaining -= 1;
  }
  return current;
}

/**
 * Working days from `from` to `to`, counting each working day after `from` up to and including
 * `to`. Negative when `to` is before `from`. Same day → 0.
 */
export function workingDaysBetween(from: IsoDate, to: IsoDate): number {
  if (from === to) return 0;
  const forward = from < to;
  const [start, end] = forward ? [from, to] : [to, from];
  let count = 0;
  let current = start;
  while (current < end) {
    current = addDays(current, 1);
    if (isWorkingDay(current)) count += 1;
  }
  return forward ? count : -count;
}

export type DueState =
  | { kind: "overdue"; workingDays: number }
  | { kind: "today" }
  | { kind: "upcoming"; workingDays: number };

/** How a due date reads relative to today: "2 days overdue", "due today", "3 days left". */
export function dueState(due: IsoDate, today: IsoDate): DueState {
  if (due === today) return { kind: "today" };
  const diff = workingDaysBetween(today, due);
  if (due < today) return { kind: "overdue", workingDays: Math.max(1, -diff) };
  return { kind: "upcoming", workingDays: Math.max(diff, 0) };
}
