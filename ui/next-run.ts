import { parseRoutines } from "../src/routine";
import { nextRun } from "../src/schedule";

const time = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Local calendar days from `from` to `to`, whatever the daylight saving shifts between them. */
function daysBetween(from: Date, to: Date): number {
  const midnight = (day: Date) => Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  return Math.round((midnight(to) - midnight(from)) / 86_400_000);
}

/** The soonest run among enabled routines: "09:00" today, "Mon 09:00" within the week, "Oct 20 09:00" beyond; `null` when none is scheduled. */
export function nextRunHint(settings: unknown, now: Date): string | null {
  const runs = parseRoutines(settings)
    .routines.filter((routine) => routine.enabled)
    .map((routine) => nextRun(routine.schedule, now))
    .filter((run) => run !== null);
  if (runs.length === 0) return null;
  const soonest = new Date(Math.min(...runs.map((run) => run.getTime())));
  const days = daysBetween(now, soonest);
  if (days === 0) return time.format(soonest);
  // From a week out, a weekday would read as the coming one.
  return `${days < 7 ? weekday.format(soonest) : date.format(soonest)} ${time.format(soonest)}`;
}
