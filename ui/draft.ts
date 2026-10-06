import { normalizeTags, WEEKDAYS, type Priority, type Routine, type Weekday } from "../src/routine";

/** The editor's schedule choices, each mapped onto one of the three schedule kinds. */
export const PRESETS = [
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "days", label: "Specific days" },
  { id: "monthly", label: "Monthly" },
  { id: "cron", label: "Custom cron" },
] as const;
export type Preset = (typeof PRESETS)[number]["id"];

/** PlaneAI's labels: a higher number is more urgent. */
export const PRIORITY_LABELS: Record<Priority, string> = { 0: "None", 1: "Low", 2: "Medium", 3: "High" };

const WORKWEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

/** A routine as the form holds it: every preset's fields stay put while the user switches between them. */
export interface Draft {
  id: string;
  name: string;
  enabled: boolean;
  project_path: string;
  preset: Preset;
  time: string;
  weekdays: Weekday[];
  /** A number input binds `undefined` while it is empty. */
  day: number | undefined;
  expression: string;
  title: string;
  description: string;
  priority: Priority;
  tags: string;
}

export function newDraft(id: string, project_path: string): Draft {
  return {
    id,
    name: "",
    enabled: true,
    project_path,
    preset: "weekdays",
    time: "09:00",
    weekdays: [...WORKWEEK],
    day: 1,
    expression: "0 9 * * 1-5",
    title: "",
    description: "",
    priority: 0,
    tags: "",
  };
}

function presetOf(routine: Routine): Preset {
  const { schedule } = routine;
  if (schedule.kind !== "weekly") return schedule.kind;
  if (schedule.weekdays.length === WEEKDAYS.length) return "daily";
  if (schedule.weekdays.length === WORKWEEK.length && WORKWEEK.every((day) => schedule.weekdays.includes(day))) return "weekdays";
  return "days";
}

export function toDraft(routine: Routine): Draft {
  const { schedule, task } = routine;
  return {
    ...newDraft(routine.id, routine.project_path),
    name: routine.name,
    enabled: routine.enabled,
    preset: presetOf(routine),
    ...(schedule.kind === "cron" ? { expression: schedule.expression } : { time: schedule.time }),
    ...(schedule.kind === "weekly" ? { weekdays: [...schedule.weekdays] } : {}),
    ...(schedule.kind === "monthly" ? { day: schedule.day } : {}),
    title: task.title,
    description: task.description,
    priority: task.priority,
    tags: task.tags.join(", "),
  };
}

export function toSchedule(draft: Draft): unknown {
  switch (draft.preset) {
    case "daily":
      return { kind: "weekly", time: draft.time, weekdays: [...WEEKDAYS] };
    case "weekdays":
      return { kind: "weekly", time: draft.time, weekdays: [...WORKWEEK] };
    case "days":
      return { kind: "weekly", time: draft.time, weekdays: WEEKDAYS.filter((day) => draft.weekdays.includes(day)) };
    case "monthly":
      return { kind: "monthly", time: draft.time, day: draft.day };
    case "cron":
      return { kind: "cron", expression: draft.expression.trim() };
  }
}

/** The settings entry the draft saves as, for `checkRoutine` to validate exactly what will be written. */
export function toEntry(draft: Draft): Record<string, unknown> {
  return {
    id: draft.id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    project_path: draft.project_path,
    schedule: toSchedule(draft),
    task: {
      title: draft.title.trim(),
      description: draft.description,
      priority: draft.priority,
      tags: normalizeTags(draft.tags.split(",")),
    },
  };
}
