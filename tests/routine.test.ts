import { describe, expect, it } from "vitest";
import { checkRoutine, parseRoutines } from "../src/routine";

const valid = {
  id: "r1",
  name: "Weekly retro",
  enabled: true,
  project_path: "/work/app",
  schedule: { kind: "weekly", time: "09:00", weekdays: ["fri", "mon", "fri"] },
  task: { title: "Retro {{date}}", description: "Notes", priority: 2, tags: [" ritual ", "team", "ritual", ""] },
};

describe("parseRoutines", () => {
  it("parses a valid document, normalizing weekdays and tags", () => {
    const { routines, problems } = parseRoutines({ tick_interval_ms: 1000, routines: [valid] });
    expect(routines).toEqual([
      {
        id: "r1",
        name: "Weekly retro",
        enabled: true,
        project_path: "/work/app",
        schedule: { kind: "weekly", time: "09:00", weekdays: ["mon", "fri"] },
        task: {
          title: "Retro {{date}}",
          description: "Notes",
          priority: 2,
          tags: ["ritual", "team"],
          start: { enabled: true, provider: null, use_worktree: true, auto_approve: true },
        },
      },
    ]);
    expect([...problems]).toEqual([]);
  });

  it("defaults the optional task fields", () => {
    const { routines } = parseRoutines({ routines: [{ ...valid, schedule: { kind: "monthly", time: "23:59", day: 31 }, task: { title: "Pay" } }] });
    expect(routines[0].schedule).toEqual({ kind: "monthly", time: "23:59", day: 31 });
    expect(routines[0].task).toEqual({
      title: "Pay",
      description: "",
      priority: 0,
      tags: [],
      start: { enabled: true, provider: null, use_worktree: true, auto_approve: true },
    });
  });

  it("reads a session start, defaulting each missing field like PlaneAI's task form", () => {
    const start = (value: unknown) => parseRoutines({ routines: [{ ...valid, task: { ...valid.task, start: value } }] }).routines[0].task.start;
    expect(start({ enabled: false, provider: "codex", use_worktree: false, auto_approve: false })).toEqual({ enabled: false, provider: "codex", use_worktree: false, auto_approve: false });
    expect(start({ provider: "claude" })).toEqual({ enabled: true, provider: "claude", use_worktree: true, auto_approve: true });
    expect(start({ enabled: false, provider: null })).toEqual({ enabled: false, provider: null, use_worktree: true, auto_approve: true });
  });

  it("treats a missing or malformed list as no routines", () => {
    expect(parseRoutines({}).routines).toEqual([]);
    expect(parseRoutines({ routines: "nope" }).routines).toEqual([]);
    expect(parseRoutines(null).routines).toEqual([]);
  });

  it.each([
    ["name", { ...valid, name: "  " }, "Enter a name."],
    ["enabled", { ...valid, enabled: "yes" }, "Enabled must be true or false."],
    ["project", { ...valid, project_path: "" }, "Choose a project."],
    ["schedule kind", { ...valid, schedule: { kind: "hourly" } }, "Schedule must be weekly, monthly or cron."],
    ["time", { ...valid, schedule: { kind: "weekly", time: "9:00", weekdays: ["mon"] } }, "Time must be HH:MM, from 00:00 to 23:59."],
    ["no weekdays", { ...valid, schedule: { kind: "weekly", time: "09:00", weekdays: [] } }, "Pick at least one day."],
    ["unknown weekday", { ...valid, schedule: { kind: "weekly", time: "09:00", weekdays: ["mon", "funday"] } }, "Weekdays must be mon to sun."],
    ["day", { ...valid, schedule: { kind: "monthly", time: "09:00", day: 32 } }, "Day of month must be a whole number from 1 to 31."],
    ["cron", { ...valid, schedule: { kind: "cron", expression: "0 9 * *" } }, "Cron needs 5 fields: minute hour day-of-month month day-of-week."],
    ["task", { ...valid, task: "Retro" }, "Task must be an object."],
    ["title", { ...valid, task: { ...valid.task, title: "" } }, "Enter a task title."],
    ["description", { ...valid, task: { ...valid.task, description: 3 } }, "Description must be text."],
    ["priority", { ...valid, task: { ...valid.task, priority: 4 } }, "Priority must be 0, 1, 2 or 3."],
    ["tags", { ...valid, task: { ...valid.task, tags: "a,b" } }, "Tags must be a list of text."],
    ["session start", { ...valid, task: { ...valid.task, start: true } }, "Session start must be an object."],
    ["start switch", { ...valid, task: { ...valid.task, start: { enabled: "yes" } } }, "Start session must be true or false."],
    ["provider", { ...valid, task: { ...valid.task, start: { provider: " " } } }, "Provider must be a provider key, or null for PlaneAI's default."],
    ["worktree", { ...valid, task: { ...valid.task, start: { use_worktree: 1 } } }, "Worktree must be true or false."],
    ["auto-approve", { ...valid, task: { ...valid.task, start: { auto_approve: null } } }, "Auto-approve must be true or false."],
  ])("reports a malformed %s for that routine only", (_, broken, problem) => {
    const other = { ...valid, id: "r2" };
    const { routines, problems } = parseRoutines({ routines: [{ ...broken, id: "bad" }, other] });
    expect(routines.map((routine) => routine.id)).toEqual(["r2"]);
    expect([...problems]).toEqual([["bad", problem]]);
  });

  it("keys a routine without a usable id by its position", () => {
    const { problems } = parseRoutines({ routines: [valid, 7, { ...valid, id: "" }] });
    expect([...problems]).toEqual([
      ["routines[1]", "Routine must be an object."],
      ["routines[2]", "Routine id must be a nonempty string."],
    ]);
  });

  it("refuses routines that share an id, since their run state would collide", () => {
    const { routines, problems } = parseRoutines({ routines: [valid, { ...valid, name: "Copy" }, { ...valid, id: "r3" }] });
    expect(routines.map((routine) => routine.id)).toEqual(["r3"]);
    expect([...problems]).toEqual([["r1", "Another routine has the same id."]]);
  });
});

describe("checkRoutine", () => {
  it("reports every problem with the field it belongs to, for the editor", () => {
    expect(checkRoutine({ ...valid, name: "", project_path: "", schedule: { kind: "weekly", time: "09:00", weekdays: [] }, task: { title: " " } })).toEqual({
      problems: [
        { field: "name", message: "Enter a name." },
        { field: "project", message: "Choose a project." },
        { field: "weekdays", message: "Pick at least one day." },
        { field: "title", message: "Enter a task title." },
      ],
    });
  });
});
