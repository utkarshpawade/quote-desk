import { describe, expect, it } from "vitest";
import { addWorkingDays, dueState, toIstDate, workingDaysBetween } from "./calendar";

// 2026-11-01 is a Sunday; 2026-11-03 is a Tuesday.

describe("working days (Sundays off)", () => {
  it("adds working days across a Sunday", () => {
    expect(addWorkingDays("2026-11-06", 1)).toBe("2026-11-07"); // Fri → Sat
    expect(addWorkingDays("2026-11-07", 1)).toBe("2026-11-09"); // Sat → Mon
    expect(addWorkingDays("2026-11-03", 4)).toBe("2026-11-07"); // the client's 4-day target
  });

  it("counts working days between dates, signed", () => {
    expect(workingDaysBetween("2026-11-03", "2026-11-03")).toBe(0);
    expect(workingDaysBetween("2026-10-31", "2026-11-02")).toBe(1); // Sat → Mon skips Sunday
    expect(workingDaysBetween("2026-11-09", "2026-11-03")).toBe(-5);
  });

  it("describes a due date relative to today", () => {
    expect(dueState("2026-11-03", "2026-11-03")).toEqual({ kind: "today" });
    expect(dueState("2026-11-05", "2026-11-03")).toEqual({ kind: "upcoming", workingDays: 2 });
    expect(dueState("2026-11-02", "2026-11-03")).toEqual({ kind: "overdue", workingDays: 1 });
    // Due on a Sunday that has passed is still overdue by at least one day.
    expect(dueState("2026-11-01", "2026-11-02")).toEqual({ kind: "overdue", workingDays: 1 });
  });

  it("uses the India calendar date", () => {
    expect(toIstDate(new Date("2026-11-02T19:00:00Z"))).toBe("2026-11-03");
    expect(toIstDate(new Date("2026-11-02T18:00:00Z"))).toBe("2026-11-02");
  });
});
