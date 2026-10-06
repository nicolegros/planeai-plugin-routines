import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutineStatus, RoutinesUiContext } from "../ui/host";
import Routines from "../ui/Routines.svelte";

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flushSync();
};

const retro = {
  id: "r1",
  name: "Weekly retro",
  enabled: true,
  project_path: "/work/app",
  schedule: { kind: "weekly", time: "09:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
  task: { title: "Retro {{date}}", description: "", priority: 0, tags: [] },
  note: "kept by a newer version",
};

function harness(settings: Record<string, unknown>, statuses: RoutineStatus[] = []) {
  const replaced: Record<string, unknown>[] = [];
  const call = vi.fn(async (method: string, params?: unknown) => {
    if (method === "routines.status") return { routines: statuses };
    if (method === "routines.runNow") return { task: { key: "APP-7", params }, session: "starting" };
    throw new Error(`unexpected ${method}`);
  });
  const context: RoutinesUiContext = {
    host: {
      call: call as RoutinesUiContext["host"]["call"],
      rpc: {
        call: (async () => ({ projects: [{ id: "p1", name: "App", path: "/work/app", hidden: false }, { id: "p2", name: "Docs", path: "/work/docs", hidden: false }] })) as RoutinesUiContext["host"]["rpc"]["call"],
      },
      settings: {
        get: (async () => settings) as RoutinesUiContext["host"]["settings"]["get"],
        replace: (async (next: Record<string, unknown>) => {
          replaced.push(next);
          return next;
        }) as RoutinesUiContext["host"]["settings"]["replace"],
      },
      data: { notify: vi.fn() },
    },
  };
  return { context, replaced, call, notify: context.host.data.notify as ReturnType<typeof vi.fn> };
}

const button = (name: string) => {
  const found = [...document.querySelectorAll("button")].find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent?.trim()) === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
};

function field<T extends HTMLElement = HTMLInputElement>(label: string): T {
  const found = [...document.querySelectorAll("label")].find((candidate) => candidate.querySelector(".label")?.textContent === label)?.querySelector("input, select, textarea");
  if (!found) throw new Error(`no field ${label}`);
  return found as T;
}

function type(element: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  element.value = text;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function choose(element: HTMLSelectElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
}

describe("Routines pane", () => {
  let app: ReturnType<typeof mount> | undefined;
  const open = async (context: RoutinesUiContext) => {
    app = mount(Routines, { target: document.body, props: { context } });
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z"), toFake: ["Date", "setInterval", "clearInterval"] });
  });

  afterEach(() => {
    if (app) unmount(app);
    app = undefined;
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("offers one call to action when there are no routines", async () => {
    await open(harness({}).context);
    expect(document.querySelector(".empty h2")?.textContent).toBe("No routines yet");
    button("Create your first routine").click();
    flushSync();
    expect(document.activeElement).toBe(field("Name"));
  });

  it("creates a routine through the form, writing the whole document and keeping unknown keys", async () => {
    const { context, replaced } = harness({ tick_interval_ms: 45_000, routines: [retro] });
    await open(context);
    button("New routine").click();
    flushSync();
    type(field("Name"), "Release notes");
    choose(field<HTMLSelectElement>("Project"), "/work/docs");
    choose(field<HTMLSelectElement>("Repeats"), "days");
    for (const day of ["Tue", "Wed", "Thu"]) button(day).click();
    flushSync();
    type(field("Time"), "07:30");
    type(field("Title"), "Notes for week {{week}}");
    type(field<HTMLTextAreaElement>("Description"), "Collect {{month}} changes");
    choose(field<HTMLSelectElement>("Priority"), "3");
    type(field("Tags"), " release, docs ,release,");
    button("Create routine").click();
    await settle();
    const id = (replaced[0].routines as { id: string }[])[1].id;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(replaced).toEqual([
      {
        tick_interval_ms: 45_000,
        routines: [
          retro,
          {
            id,
            name: "Release notes",
            enabled: true,
            project_path: "/work/docs",
            schedule: { kind: "weekly", time: "07:30", weekdays: ["mon", "fri"] },
            task: {
              title: "Notes for week {{week}}",
              description: "Collect {{month}} changes",
              priority: 3,
              tags: ["release", "docs"],
              start: { enabled: true, provider: null, use_worktree: true, auto_approve: true },
            },
          },
        ],
      },
    ]);
  });

  it("keeps Save disabled with the reasons until the routine is valid, and previews the next runs", async () => {
    await open(harness({ routines: [] }).context);
    button("New routine").click();
    flushSync();
    expect(button("Create routine").disabled).toBe(true);
    expect(document.querySelector(".reasons")?.textContent).toBe("Enter a name. Enter a task title.");
    type(field("Name"), "Standup");
    type(field("Title"), "Standup {{weekday}}");
    expect(button("Create routine").disabled).toBe(false);
    expect([...document.querySelectorAll(".runs time")].map((time) => time.textContent)).toEqual(["Tue, Oct 6, 09:00", "Wed, Oct 7, 09:00", "Thu, Oct 8, 09:00"]);
    expect(document.querySelector(".next-title")?.textContent).toBe("Next task: Standup Tuesday");
    choose(field<HTMLSelectElement>("Repeats"), "cron");
    type(field("Cron expression"), "0 9 * *");
    expect(document.getElementById("cron-validity")?.textContent?.trim()).toBe("Cron needs 5 fields: minute hour day-of-month month day-of-week.");
    expect(button("Create routine").disabled).toBe(true);
    choose(field<HTMLSelectElement>("Repeats"), "days");
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) button(day).click();
    flushSync();
    expect(document.getElementById("problem-weekdays")?.textContent).toBe("Pick at least one day.");
  });

  it("toggles, edits and deletes a routine", async () => {
    const other = { ...retro, id: "r2", name: "Other", task: { ...retro.task, start: { enabled: false, provider: "codex", use_worktree: false, auto_approve: true } } };
    const { context, replaced } = harness({ routines: [retro, other] });
    await open(context);
    const toggle = document.querySelector<HTMLInputElement>('[aria-label="Enable Weekly retro"]')!;
    toggle.click();
    await settle();
    expect(replaced.at(-1)).toEqual({ routines: [{ ...retro, enabled: false }, other] });
    expect(document.querySelector('[aria-labelledby="routine-r1"]')?.textContent).toContain("Paused");

    button("Edit Other").click();
    flushSync();
    type(field("Name"), "Renamed");
    button("Save").click();
    await settle();
    expect((replaced.at(-1)!.routines as Record<string, unknown>[])[1]).toEqual({
      id: "r2",
      name: "Renamed",
      enabled: true,
      project_path: "/work/app",
      schedule: { kind: "weekly", time: "09:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
      task: { title: "Retro {{date}}", description: "", priority: 0, tags: [], start: { enabled: false, provider: "codex", use_worktree: false, auto_approve: true } },
    });
    expect(document.activeElement).toBe(button("Edit Renamed"));

    button("Delete Weekly retro").click();
    flushSync();
    expect(replaced).toHaveLength(2);
    button("Delete").click();
    await settle();
    expect((replaced.at(-1)!.routines as { id: string }[]).map((routine) => routine.id)).toEqual(["r2"]);
  });

  it("shows the next run, the last task and errors from the sidecar", async () => {
    const { context } = harness({ routines: [retro, { ...retro, id: "r2", name: "Broken", project_path: "/gone" }, { id: "r3", name: "Half" }] }, [
      { id: "r1", next_run: "2026-10-06T13:00:00.000Z", last_fired: "2026-10-05T13:00:00.000Z", last_task_key: "APP-12", error: null },
      { id: "r2", next_run: "2026-10-06T13:00:00.000Z", last_fired: null, last_task_key: null, error: "project was not found or is hidden" },
      { id: "r3", next_run: null, last_fired: null, last_task_key: null, error: "Enable must be set." },
    ]);
    await open(context);
    const row = (id: string) => document.querySelector(`[aria-labelledby="routine-${id}"]`)!;
    expect(row("r1").querySelector("time")?.textContent).toBe("in 1 hour");
    expect(row("r1").textContent).toContain("· Tue, Oct 6, 09:00");
    expect(row("r1").textContent).toContain("Weekdays at 09:00");
    expect(row("r1").querySelector(".key")?.textContent).toBe("APP-12");
    expect(row("r2").querySelector(".warning")?.textContent).toBe("Project missing or hidden");
    expect(row("r2").querySelector(".error")?.textContent).toBe("project was not found or is hidden");
    expect(row("r3").querySelector(".error")?.textContent).toContain("Enabled must be true or false.");
    expect(button("Edit Half").disabled).toBe(true);
  });

  it("runs a routine now and reports the created task", async () => {
    const { context, call, notify } = harness({ routines: [retro] });
    await open(context);
    button("Run Weekly retro now").click();
    await settle();
    expect(call).toHaveBeenCalledWith("routines.runNow", { id: "r1" });
    expect(notify).toHaveBeenCalledWith("Created APP-7. Its session is starting.", "success");
    call.mockRejectedValueOnce(new Error("project was not found or is hidden"));
    button("Run Weekly retro now").click();
    await settle();
    expect(notify).toHaveBeenLastCalledWith("Could not run Weekly retro: project was not found or is hidden", "error");
  });

  it("cancels the editor with Escape without letting PlaneAI close the pane", async () => {
    const { context, replaced } = harness({ routines: [retro] });
    await open(context);
    button("Edit Weekly retro").click();
    flushSync();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    field("Name").dispatchEvent(escape);
    flushSync();
    expect(escape.defaultPrevented).toBe(true);
    expect(document.querySelector("form")).toBeNull();
    expect(replaced).toEqual([]);
  });
});
