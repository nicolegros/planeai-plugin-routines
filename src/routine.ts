import { cronProblem } from "./schedule";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Every schedule compiles to one cron expression; `time` is a local "HH:MM". */
export type Schedule =
  | { kind: "weekly"; time: string; weekdays: Weekday[] }
  | { kind: "monthly"; time: string; day: number }
  | { kind: "cron"; expression: string };

/** PlaneAI's task priorities: a higher number is more urgent, 0 is none. */
export const PRIORITIES = [0, 1, 2, 3] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface TaskTemplate {
  title: string;
  description: string;
  priority: Priority;
  tags: string[];
}

export interface Routine {
  id: string;
  name: string;
  enabled: boolean;
  project_path: string;
  schedule: Schedule;
  task: TaskTemplate;
}

export type Field = "routine" | "id" | "name" | "enabled" | "project" | "schedule" | "time" | "weekdays" | "day" | "cron" | "task" | "title" | "description" | "priority" | "tags";

export interface Problem {
  field: Field;
  message: string;
}

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isWeekday = (value: unknown): value is Weekday => WEEKDAYS.includes(value as Weekday);
const isPriority = (value: unknown): value is Priority => PRIORITIES.includes(value as Priority);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Trimmed, nonempty and unique, in the order given. */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

/** Records a problem and stands in for the value that could not be read. */
function failer(problems: Problem[]) {
  return (field: Field, message: string): null => {
    problems.push({ field, message });
    return null;
  };
}

function parseSchedule(value: unknown, problems: Problem[]): Schedule | null {
  const fail = failer(problems);
  if (!isObject(value)) return fail("schedule", "Schedule must be weekly, monthly or cron.");
  const time = () => (typeof value.time === "string" && TIME.test(value.time) ? value.time : fail("time", "Time must be HH:MM, from 00:00 to 23:59."));
  switch (value.kind) {
    case "weekly": {
      const at = time();
      const days = value.weekdays;
      const weekdays = !Array.isArray(days) || !days.every(isWeekday)
        ? fail("weekdays", "Weekdays must be mon to sun.")
        : days.length === 0
          ? fail("weekdays", "Pick at least one day.")
          : WEEKDAYS.filter((day) => days.includes(day));
      return at === null || weekdays === null ? null : { kind: "weekly", time: at, weekdays };
    }
    case "monthly": {
      const at = time();
      const day = typeof value.day === "number" && Number.isInteger(value.day) && value.day >= 1 && value.day <= 31 ? value.day : fail("day", "Day of month must be a whole number from 1 to 31.");
      return at === null || day === null ? null : { kind: "monthly", time: at, day };
    }
    case "cron": {
      const expression = typeof value.expression === "string" ? value.expression : "";
      const problem = cronProblem(expression);
      return problem ? fail("cron", problem) : { kind: "cron", expression };
    }
    default:
      return fail("schedule", "Schedule must be weekly, monthly or cron.");
  }
}

function parseTask(value: unknown, problems: Problem[]): TaskTemplate | null {
  const fail = failer(problems);
  if (!isObject(value)) return fail("task", "Task must be an object.");
  const { title: rawTitle, description: rawDescription = "", priority: rawPriority = 0, tags: rawTags = [] } = value;
  const title = isText(rawTitle) ? rawTitle : fail("title", "Enter a task title.");
  const description = typeof rawDescription === "string" ? rawDescription : fail("description", "Description must be text.");
  const priority = isPriority(rawPriority) ? rawPriority : fail("priority", "Priority must be 0, 1, 2 or 3.");
  const tags = Array.isArray(rawTags) && rawTags.every((tag) => typeof tag === "string") ? normalizeTags(rawTags) : fail("tags", "Tags must be a list of text.");
  return title === null || description === null || priority === null || tags === null ? null : { title, description, priority, tags };
}

/** One routine from the settings document: the routine, or every problem found, each with its field. */
export function checkRoutine(value: unknown): { routine: Routine } | { problems: Problem[] } {
  if (!isObject(value)) return { problems: [{ field: "routine", message: "Routine must be an object." }] };
  const problems: Problem[] = [];
  const fail = failer(problems);
  const id = isText(value.id) ? value.id : fail("id", "Routine id must be a nonempty string.");
  const name = isText(value.name) ? value.name : fail("name", "Enter a name.");
  const enabled = typeof value.enabled === "boolean" ? value.enabled : fail("enabled", "Enabled must be true or false.");
  const project_path = isText(value.project_path) ? value.project_path : fail("project", "Choose a project.");
  const schedule = parseSchedule(value.schedule, problems);
  const task = parseTask(value.task, problems);
  if (id === null || name === null || enabled === null || project_path === null || schedule === null || task === null) return { problems };
  return { routine: { id, name, enabled, project_path, schedule, task } };
}

/** How a settings entry is identified: its id, or its position when it has no usable id. */
export function routineKey(value: unknown, index: number): string {
  return isObject(value) && isText(value.id) ? value.id : `routines[${index}]`;
}

/**
 * The boundary for the settings document. A malformed routine yields a problem under its key
 * and never blocks the others; everything past this point trusts the types.
 */
export function parseRoutines(settings: unknown): { routines: Routine[]; problems: Map<string, string> } {
  const entries = isObject(settings) && Array.isArray(settings.routines) ? settings.routines : [];
  const keys = entries.map(routineKey);
  const routines: Routine[] = [];
  const problems = new Map<string, string>();
  entries.forEach((entry, index) => {
    const key = keys[index];
    if (keys.indexOf(key) !== keys.lastIndexOf(key)) {
      problems.set(key, "Another routine has the same id.");
      return;
    }
    const checked = checkRoutine(entry);
    if ("routine" in checked) routines.push(checked.routine);
    else problems.set(key, checked.problems.map((problem) => problem.message).join(" "));
  });
  return { routines, problems };
}
