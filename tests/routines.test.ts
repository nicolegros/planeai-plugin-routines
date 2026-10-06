import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RpcError } from "../src/rpc";
import { RoutinesPlugin, type Host, type TaskRequest } from "../src/routines";
import { StateStore } from "../src/state";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "planeai-plugin.json"), "utf8"));

const retro = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  name: "Weekly retro",
  enabled: true,
  project_path: "/work/app",
  schedule: { kind: "weekly", time: "09:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
  task: { title: "Retro {{date}}", description: "{{weekday}} at {{time}}", priority: 3, tags: ["ritual"] },
  ...overrides,
});

/** PlaneAI as the sidecar sees it, with a clock the test moves. */
function harness(routines: unknown[] = [retro()]) {
  const dir = mkdtempSync(join(tmpdir(), "routines-plugin-"));
  const statePath = join(dir, "routines-state.json");
  const created: TaskRequest[] = [];
  const world = {
    settings: { tick_interval_ms: 30_000, routines } as Record<string, unknown>,
    now: new Date("2026-10-06T12:00:00Z"),
    failure: null as Error | null,
    beforeCreate: () => {},
  };
  const host: Host = {
    settings: async () => world.settings,
    createTask: async (request) => {
      world.beforeCreate();
      if (world.failure) throw world.failure;
      created.push(request);
      return { task: { key: `APP-${created.length}`, title: request.title }, ...(request.start ? { session: "starting" as const } : {}) };
    },
  };
  const plugin = new RoutinesPlugin(host, new StateStore(statePath), () => world.now);
  const at = (instant: string) => (world.now = new Date(instant));
  const tick = () => plugin.handle("routines.tick", null);
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  return { plugin, world, created, at, tick, state };
}

describe("RoutinesPlugin", () => {
  it("asks for the capabilities it uses, including starting sessions", () => {
    expect(manifest.capabilities).toEqual(["settings", "projects.read", "tasks.create", "sessions.start"]);
  });

  it("handshakes with the identity the manifest declares", async () => {
    const result = await harness().plugin.handle("plugin.handshake", { host_api_version: manifest.host_api_version });
    expect(result).toEqual({
      plugin_id: manifest.id,
      plugin_name: manifest.name,
      plugin_version: manifest.version,
      host_api_version: manifest.host_api_version,
      lifecycle_event_subscriptions: [],
    });
  });

  it("rebaselines a new routine without firing a past occurrence", async () => {
    const { tick, created, state } = harness();
    // 08:00 in Toronto; the 09:00 of yesterday is in the past.
    await expect(tick()).resolves.toEqual({ created: 0 });
    expect(created).toEqual([]);
    expect(state()).toEqual({ r1: { fingerprint: "0 9 * * 1,2,3,4,5", last_fired: "2026-10-06T12:00:00.000Z", last_task_key: null, last_error: null } });
  });

  it("creates one task at the occurrence, rendered at the occurrence", async () => {
    const { tick, at, created, state } = harness();
    await tick();
    at("2026-10-06T13:00:25Z");
    await expect(tick()).resolves.toEqual({ created: 1 });
    at("2026-10-06T13:00:55Z");
    await expect(tick()).resolves.toEqual({ created: 0 });
    expect(created).toEqual([
      {
        project_path: "/work/app",
        operation_id: "routine:r1:2026-10-06T13:00:00Z",
        title: "Retro 2026-10-06",
        description: "Tuesday at 09:00",
        priority: 3,
        tags: ["ritual"],
        start: { provider: null, use_worktree: true, auto_approve: true },
      },
    ]);
    expect(state().r1).toEqual({ fingerprint: "0 9 * * 1,2,3,4,5", last_fired: "2026-10-06T13:00:00.000Z", last_task_key: "APP-1", last_error: null });
  });

  it("asks PlaneAI to start the routine's session, or leaves start out when the routine does not start one", async () => {
    const { tick, at, created } = harness([
      retro({ task: { title: "Review", start: { enabled: true, provider: "codex", use_worktree: false, auto_approve: false } } }),
      retro({ id: "r2", task: { title: "Plan", start: { enabled: false, provider: "codex", use_worktree: false, auto_approve: false } } }),
    ]);
    await tick();
    at("2026-10-06T13:00:10Z");
    await expect(tick()).resolves.toEqual({ created: 2 });
    expect(created).toEqual([
      {
        project_path: "/work/app",
        operation_id: "routine:r1:2026-10-06T13:00:00Z",
        title: "Review",
        description: "",
        priority: 0,
        tags: [],
        start: { provider: "codex", use_worktree: false, auto_approve: false },
      },
      { project_path: "/work/app", operation_id: "routine:r2:2026-10-06T13:00:00Z", title: "Plan", description: "", priority: 0, tags: [] },
    ]);
  });

  it("collapses the occurrences missed while PlaneAI was closed into one task for the latest", async () => {
    const { tick, at, created } = harness();
    await tick();
    at("2026-10-19T20:00:00Z");
    await expect(tick()).resolves.toEqual({ created: 1 });
    expect(created.map((task) => [task.operation_id, task.title])).toEqual([["routine:r1:2026-10-19T13:00:00Z", "Retro 2026-10-19"]]);
  });

  it("records a failure and retries the same operation on the next tick", async () => {
    const { plugin, tick, at, world, created, state } = harness();
    await tick();
    at("2026-10-06T13:00:10Z");
    world.failure = new RpcError(-32602, "project was not found or is hidden");
    await expect(tick()).resolves.toEqual({ created: 0 });
    expect(state().r1).toMatchObject({ last_fired: "2026-10-06T12:00:00.000Z", last_error: "project was not found or is hidden" });
    await expect(plugin.handle("routines.status", null)).resolves.toMatchObject({ routines: [{ id: "r1", error: "project was not found or is hidden" }] });
    world.failure = null;
    at("2026-10-06T13:00:40Z");
    await expect(tick()).resolves.toEqual({ created: 1 });
    expect(created.map((task) => task.operation_id)).toEqual(["routine:r1:2026-10-06T13:00:00Z"]);
    expect(state().r1).toMatchObject({ last_task_key: "APP-1", last_error: null });
  });

  it("explains that an older PlaneAI cannot create tasks", async () => {
    const { tick, at, world, state } = harness();
    await tick();
    at("2026-10-06T13:00:10Z");
    world.failure = new RpcError(-32601, "unknown host method host.tasks.create");
    await tick();
    expect(state().r1.last_error).toBe("This PlaneAI version cannot create tasks from plugins. Update PlaneAI.");
  });

  it("never fires a disabled routine, and re-enabling it does not fire a stale occurrence", async () => {
    const { tick, at, world, created, state } = harness();
    await tick();
    world.settings = { routines: [retro({ enabled: false })] };
    at("2026-10-06T14:00:00Z");
    await expect(tick()).resolves.toEqual({ created: 0 });
    expect(state()).toEqual({});
    world.settings = { routines: [retro()] };
    at("2026-10-06T15:00:00Z");
    await expect(tick()).resolves.toEqual({ created: 0 });
    at("2026-10-07T13:00:05Z");
    await expect(tick()).resolves.toEqual({ created: 1 });
    expect(created.map((task) => task.operation_id)).toEqual(["routine:r1:2026-10-07T13:00:00Z"]);
  });

  it("finishes one tick before the next, so overlapping ticks create a task once", async () => {
    const { plugin, tick, at, created } = harness();
    await tick();
    at("2026-10-06T13:00:10Z");
    const results = await Promise.all([tick(), plugin.handle("routines.tick", null)]);
    expect(results).toEqual([{ created: 1 }, { created: 0 }]);
    expect(created).toHaveLength(1);
  });

  it("stops at a cancellation and keeps the state of the routines it did not reach", async () => {
    const { plugin, tick, at, world, created, state } = harness([retro(), retro({ id: "r2" })]);
    await tick();
    const controller = new AbortController();
    world.beforeCreate = () => controller.abort();
    at("2026-10-06T13:00:10Z");
    await plugin.handle("routines.tick", null, controller.signal);
    expect(created.map((task) => task.operation_id)).toEqual(["routine:r1:2026-10-06T13:00:00Z"]);
    expect(state().r1.last_task_key).toBe("APP-1");
    expect(state().r2.last_fired).toBe("2026-10-06T12:00:00.000Z");
  });

  it("rebaselines a rescheduled routine instead of firing the new schedule's past occurrence", async () => {
    const { tick, at, world, created, state } = harness();
    await tick();
    at("2026-10-06T15:00:00Z");
    world.settings = { routines: [retro({ schedule: { kind: "weekly", time: "10:00", weekdays: ["tue"] } })] };
    await expect(tick()).resolves.toEqual({ created: 0 });
    expect(created).toEqual([]);
    expect(state().r1).toEqual({ fingerprint: "0 10 * * 2", last_fired: "2026-10-06T15:00:00.000Z", last_task_key: null, last_error: null });
  });

  it("prunes the state of deleted and invalid routines", async () => {
    const { tick, world, state } = harness([retro(), retro({ id: "r2" })]);
    await tick();
    expect(Object.keys(state())).toEqual(["r1", "r2"]);
    world.settings = { routines: [retro({ id: "r2", name: "" })] };
    await tick();
    expect(state()).toEqual({});
  });

  it("reports next runs, last tasks and problems without writing", async () => {
    const { plugin, tick, at, state } = harness([retro(), retro({ id: "r2", enabled: false }), retro({ id: "r3", task: { title: "" } })]);
    await tick();
    at("2026-10-06T13:00:10Z");
    await tick();
    const before = state();
    at("2026-10-06T13:30:00Z");
    await expect(plugin.handle("routines.status", null)).resolves.toEqual({
      routines: [
        { id: "r1", next_run: "2026-10-07T13:00:00.000Z", last_fired: "2026-10-06T13:00:00.000Z", last_task_key: "APP-1", error: null },
        { id: "r2", next_run: null, last_fired: null, last_task_key: null, error: null },
        { id: "r3", next_run: null, last_fired: null, last_task_key: null, error: "Enter a task title." },
      ],
    });
    expect(state()).toEqual(before);
  });

  it("runs a routine now, even a disabled one, without moving its schedule", async () => {
    const { plugin, tick, at, world, created, state } = harness();
    await tick();
    world.settings = { routines: [retro({ enabled: false })] };
    at("2026-10-06T15:30:12.345Z");
    await expect(plugin.handle("routines.runNow", { id: "r1" })).resolves.toEqual({ task: { key: "APP-1", title: "Retro 2026-10-06" }, session: "starting" });
    expect(created).toEqual([
      {
        project_path: "/work/app",
        operation_id: "routine:r1:manual:2026-10-06T15:30:12.345Z",
        title: "Retro 2026-10-06",
        description: "Tuesday at 11:30",
        priority: 3,
        tags: ["ritual"],
        start: { provider: null, use_worktree: true, auto_approve: true },
      },
    ]);
    expect(state().r1.last_fired).toBe("2026-10-06T12:00:00.000Z");
  });

  it("refuses to run a routine that is missing or invalid", async () => {
    const { plugin } = harness([retro({ id: "r3", task: { title: "" } })]);
    await expect(plugin.handle("routines.runNow", { id: "nope" })).rejects.toThrow("This routine no longer exists.");
    await expect(plugin.handle("routines.runNow", { id: "r3" })).rejects.toThrow("Enter a task title.");
    await expect(plugin.handle("routines.runNow", {})).rejects.toMatchObject({ code: -32602 });
  });
});
