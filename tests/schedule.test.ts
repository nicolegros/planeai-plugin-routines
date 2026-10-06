import { describe, expect, it } from "vitest";
import type { Schedule, Weekday } from "../src/routine";
import { cronProblem, describe as describeSchedule, latestOccurrence, nextRun, toCron } from "../src/schedule";

const weekly = (weekdays: Weekday[], time = "09:00"): Schedule => ({ kind: "weekly", time, weekdays });
const iso = (date: Date | null) => date?.toISOString() ?? null;

describe("toCron", () => {
  it("compiles every kind to one five-field expression", () => {
    expect(toCron(weekly(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]))).toBe("0 9 * * *");
    expect(toCron(weekly(["fri", "mon"], "07:05"))).toBe("5 7 * * 1,5");
    expect(toCron(weekly(["sun"], "23:59"))).toBe("59 23 * * 0");
    expect(toCron({ kind: "monthly", time: "00:30", day: 31 })).toBe("30 0 31 * *");
    expect(toCron({ kind: "cron", expression: "  0  */2 * *   * " })).toBe("0 */2 * * *");
  });
});

describe("describe", () => {
  it("names the schedule as a person would", () => {
    expect(describeSchedule(weekly(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]))).toBe("Every day at 09:00");
    expect(describeSchedule(weekly(["fri", "thu", "wed", "tue", "mon"]))).toBe("Weekdays at 09:00");
    expect(describeSchedule(weekly(["fri", "mon"]))).toBe("Mon, Fri at 09:00");
    expect(describeSchedule({ kind: "monthly", time: "09:00", day: 1 })).toBe("Monthly on day 1 at 09:00");
    expect(describeSchedule({ kind: "cron", expression: "0 */2 * * *" })).toBe("Cron 0 */2 * * *");
  });
});

describe("cronProblem", () => {
  it("accepts standard five-field expressions only", () => {
    expect(cronProblem("0 */2 * * 1-5")).toBeNull();
    expect(cronProblem("")).toBe("Enter a cron expression.");
    expect(cronProblem("0 9 * *")).toBe("Cron needs 5 fields: minute hour day-of-month month day-of-week.");
    expect(cronProblem("0 0 9 * * *")).toBe("Cron needs 5 fields: minute hour day-of-month month day-of-week.");
    expect(cronProblem("61 9 * * *")).toBe("Cron is not valid: Invalid value for minute: 61");
  });
});

describe("nextRun", () => {
  it("finds the next occurrence strictly after an instant, in local time", () => {
    // Tuesday 2026-10-06 08:00 in Toronto (EDT, UTC-4).
    const tuesday = new Date("2026-10-06T12:00:00Z");
    expect(iso(nextRun(weekly(["mon", "fri"]), tuesday))).toBe("2026-10-09T13:00:00.000Z");
    expect(iso(nextRun(weekly(["tue"], "08:00"), tuesday))).toBe("2026-10-13T12:00:00.000Z");
    expect(iso(nextRun({ kind: "monthly", time: "09:00", day: 1 }, tuesday))).toBe("2026-11-01T14:00:00.000Z");
  });

  it("skips months without the day", () => {
    expect(iso(nextRun({ kind: "monthly", time: "09:00", day: 31 }, new Date("2026-11-01T00:00:00Z")))).toBe("2026-12-31T14:00:00.000Z");
  });

  it("gives up beyond 400 days", () => {
    expect(nextRun({ kind: "cron", expression: "0 9 30 2 *" }, new Date("2026-10-06T12:00:00Z"))).toBeNull();
    expect(iso(nextRun({ kind: "cron", expression: "0 0 29 2 *" }, new Date("2026-10-06T12:00:00Z")))).toBeNull();
    expect(iso(nextRun({ kind: "cron", expression: "0 0 29 2 *" }, new Date("2027-03-01T12:00:00Z")))).toBe("2028-02-29T05:00:00.000Z");
  });
});

describe("latestOccurrence", () => {
  const daily = weekly(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

  it("returns the latest occurrence in (since, now]", () => {
    const since = new Date("2026-10-05T12:00:00Z");
    expect(iso(latestOccurrence(daily, since, new Date("2026-10-05T12:59:59Z")))).toBeNull();
    expect(iso(latestOccurrence(daily, since, new Date("2026-10-05T13:00:00Z")))).toBe("2026-10-05T13:00:00.000Z");
    expect(iso(latestOccurrence(daily, new Date("2026-10-05T13:00:00Z"), new Date("2026-10-05T13:00:30Z")))).toBeNull();
  });

  it("collapses a long gap into the latest occurrence", () => {
    expect(iso(latestOccurrence(daily, new Date("2026-01-01T00:00:00Z"), new Date("2026-10-06T12:00:00Z")))).toBe("2026-10-05T13:00:00.000Z");
    expect(iso(latestOccurrence({ kind: "cron", expression: "* * * * *" }, new Date("2025-01-01T00:00:00Z"), new Date("2026-10-06T12:00:30Z")))).toBe(
      "2026-10-06T12:00:00.000Z",
    );
    expect(iso(latestOccurrence({ kind: "cron", expression: "* * 1 * *" }, new Date("2025-01-01T00:00:00Z"), new Date("2026-10-20T12:00:00Z")))).toBe(
      "2026-10-02T03:59:00.000Z",
    );
  });

  it("looks back at most 400 days", () => {
    const leapDay = { kind: "cron", expression: "0 0 29 2 *" } as const;
    expect(iso(latestOccurrence(leapDay, new Date("2027-01-01T00:00:00Z"), new Date("2028-03-01T00:00:00Z")))).toBe("2028-02-29T05:00:00.000Z");
    expect(iso(latestOccurrence(leapDay, new Date("2028-01-01T00:00:00Z"), new Date("2029-06-01T00:00:00Z")))).toBeNull();
    expect(iso(latestOccurrence({ kind: "cron", expression: "0 9 30 2 *" }, new Date("2026-01-01T00:00:00Z"), new Date("2026-10-06T12:00:00Z")))).toBeNull();
  });
});
