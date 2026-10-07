import { Cron } from "croner";
import { WEEKDAYS, type Schedule, type Weekday } from "./routine";

const DAY_MS = 24 * 60 * 60 * 1000;
/** No search looks further than this, so a schedule that never or rarely matches stays cheap. */
export const HORIZON_DAYS = 400;
export const HORIZON_MS = HORIZON_DAYS * DAY_MS;

const CRON_NUMBER: Record<Weekday, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 0,
};
const LABEL: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const WORKWEEK: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

function clock(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(":").map(Number);
  return { hour, minute };
}

/** The weekdays in calendar order, without repeats. */
function ordered(weekdays: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((day) => weekdays.includes(day));
}

/** The canonical expression; two schedules that fire at the same instants compile to the same string. */
export function toCron(schedule: Schedule): string {
  switch (schedule.kind) {
    case "weekly": {
      const { hour, minute } = clock(schedule.time);
      const days = ordered(schedule.weekdays);
      return `${minute} ${hour} * * ${days.length === WEEKDAYS.length ? "*" : days.map((day) => CRON_NUMBER[day]).join(",")}`;
    }
    case "monthly": {
      const { hour, minute } = clock(schedule.time);
      return `${minute} ${hour} ${schedule.day} * *`;
    }
    case "cron":
      return schedule.expression.trim().split(/\s+/).join(" ");
  }
}

export function describe(schedule: Schedule): string {
  switch (schedule.kind) {
    case "weekly": {
      const days = ordered(schedule.weekdays);
      if (days.length === WEEKDAYS.length) return `Every day at ${schedule.time}`;
      if (days.length === WORKWEEK.length && WORKWEEK.every((day) => days.includes(day)))
        return `Weekdays at ${schedule.time}`;
      return `${days.map((day) => LABEL[day]).join(", ")} at ${schedule.time}`;
    }
    case "monthly":
      return `Monthly on day ${schedule.day} at ${schedule.time}`;
    case "cron":
      return `Cron ${toCron(schedule)}`;
  }
}

function compile(expression: string): Cron {
  // Without a timezone option croner evaluates in the machine's local zone.
  return new Cron(expression, { paused: true, mode: "5-part" });
}

/** Why an expression cannot be used, or `null` when it can. */
export function cronProblem(expression: string): string | null {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length === 0) return "Enter a cron expression.";
  if (fields.length !== 5)
    return "Cron needs 5 fields: minute hour day-of-month month day-of-week.";
  try {
    compile(fields.join(" "));
    return null;
  } catch (error) {
    return `Cron is not valid: ${String(error instanceof Error ? error.message : error).replace(/^CronPattern: /, "")}`;
  }
}

/** The first occurrence after `after`, or `null` when none falls within the horizon. */
export function nextRun(schedule: Schedule, after: Date): Date | null {
  const next = compile(toCron(schedule)).nextRun(after);
  return next && next.getTime() - after.getTime() <= HORIZON_MS ? next : null;
}

const LOOKBACK_WINDOWS_MS = [60_000, 60 * 60_000, DAY_MS, 7 * DAY_MS, 32 * DAY_MS, HORIZON_MS];

/** The latest occurrence `o` with `since < o <= now`, looking back at most the horizon. */
export function latestOccurrence(schedule: Schedule, since: Date, now: Date): Date | null {
  const cron = compile(toCron(schedule));
  const floor = Math.max(since.getTime(), now.getTime() - HORIZON_MS);
  // Widening windows bound the forward walk to the occurrences of the first window that has one.
  for (const window of LOOKBACK_WINDOWS_MS) {
    const start = Math.max(floor, now.getTime() - window);
    let latest: Date | null = null;
    for (
      let next = cron.nextRun(new Date(start));
      next && next.getTime() <= now.getTime();
      next = cron.nextRun(next)
    )
      latest = next;
    if (latest || start === floor) return latest;
  }
  return null;
}
