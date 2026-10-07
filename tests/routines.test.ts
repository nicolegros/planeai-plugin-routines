import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RpcError } from "../src/rpc";
import {
  RoutinesPlugin,
  type CreatedTask,
  type Host,
  type TaskCreation,
  type TaskRequest,
} from "../src/routines";
import { StateStore } from "../src/state";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "planeai-plugin.json"), "utf8"));

const retro = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  name: "Weekly retro",
  enabled: true,
  project_path: "/work/app",
  schedule: { kind: "weekly", time: "09:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
  task: {
    title: "Retro {{date}}",
    description: "{{weekday}} at {{time}}",
    priority: 3,
    tags: ["ritual"],
  },
  ...overrides,
});

/** PlaneAI as the sidecar sees it, with a clock the test moves. */
function harness(routines: unknown[] = [retro()]) {
  const dir = mkdtempSync(join(tmpdir(), "routines-plugin-"));
  const statePath = join(dir, "routines-state.json");
  const created: TaskRequest[] = [];
  const operations = new Map<string, CreatedTask>();
  const world = {
    settings: { tick_interval_ms: 30_000, routines } as Record<string, unknown>,
    now: new Date("2026-10-06T12:00:00Z"),
    failure: null as Error | null,
    /** Where a requested session stands when PlaneAI replays an operation it already created. */
    replayed: { session: "exists" } as Pick<TaskCreation, "session" | "session_error">,
    beforeCreate: () => {},
  };
  const host: Host = {
    settings: async () => world.settings,
    // PlaneAI dedupes on the operation id: a retry returns the original task, and the first start's outcome.
    createTask: async (request) => {
      world.beforeCreate();
      if (world.failure) throw world.failure;
      const known = operations.get(request.operation_id);
      if (known) return { task: known, ...(request.start ? world.replayed : {}) };
      created.push(request);
      const task = { key: `APP-${created.length}`, title: request.title };
      operations.set(request.operation_id, task);
      return { task, ...(request.start ? { session: "starting" as const } : {}) };
    },
  };
  const plugin = new RoutinesPlugin(host, new StateStore(statePath), () => world.now);
  const at = (instant: string) => (world.now = new Date(instant));
  const tick = () => plugin.handle("routines.tick", null);
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  return { plugin, world, created, at, tick, state, statePath };
}

describe("RoutinesPlugin", () => {
  it("asks for the capabilities it uses, including starting sessions", () => {
    expect(manifest.capabilities).toEqual([
      "settings",
      "projects.read",
      "tasks.create",
      "sessions.start",
    ]);
  });

  it("handshakes with the identity the manifest declares", async () => {
    const result = await harness().plugin.handle("plugin.handshake", {
      host_api_version: manifest.host_api_version,
    });
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
    expect(state()).toEqual({
      r1: {
        fingerprint: "0 9 * * 1,2,3,4,5",
        last_fired: "2026-10-06T12:00:00.000Z",
        last_task_key: null,
        last_error: null,
      },
    });
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
    expect(state().r1).toEqual({
      fingerprint: "0 9 * * 1,2,3,4,5",
      last_fired: "2026-10-06T13:00:00.000Z",
      last_task_key: "APP-1",
      last_error: null,
    });
  });

  it("asks PlaneAI to start the routine's session, or leaves start out when the routine does not start one", async () => {
    const { tick, at, created } = harness([
      retro({
        task: {
          title: "Review",
          start: { enabled: true, provider: "codex", use_worktree: false, auto_approve: false },
        },
      }),
      retro({
        id: "r2",
        task: {
          title: "Plan",
          start: { enabled: false, provider: "codex", use_worktree: false, auto_approve: false },
        },
      }),
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
      {
        project_path: "/work/app",
        operation_id: "routine:r2:2026-10-06T13:00:00Z",
        title: "Plan",
        description: "",
        priority: 0,
        tags: [],
      },
    ]);
  });

  it("collapses the occurrences missed while PlaneAI was closed into one task for the latest", async () => {
    const { tick, at, created } = harness();
    await tick();
    at("2026-10-19T20:00:00Z");
    await expect(tick()).resolves.toEqual({ created: 1 });
    expect(created.map((task) => [task.operation_id, task.title])).toEqual([
      ["routine:r1:2026-10-19T13:00:00Z", "Retro 2026-10-19"],
    ]);
  });

  it("records a failure and retries the same operation on the next tick", async () => {
    const { plugin, tick, at, world, created, state } = harness();
    await tick();
    at("2026-10-06T13:00:10Z");
    world.failure = new RpcError(-32603, "database is locked");
    await expect(tick()).resolves.toEqual({ created: 0 });
    expect(state().r1).toMatchObject({
      last_fired: "2026-10-06T12:00:00.000Z",
      last_error: "database is locked",
    });
    await expect(plugin.handle("routines.status", null)).resolves.toMatchObject({
      routines: [{ id: "r1", error: "database is locked" }],
    });
    world.failure = null;
    at("2026-10-06T13:00:40Z");
    await expect(tick()).resolves.toEqual({ created: 1 });
    expect(created.map((task) => task.operation_id)).toEqual(["routine:r1:2026-10-06T13:00:00Z"]);
    expect(state().r1).toMatchObject({ last_task_key: "APP-1", last_error: null });
  });

  it("gives up on an occurrence PlaneAI refuses, keeps its error, and fires the next one", async () => {
    const { tick, at, world, created, state } = harness();
    await tick();
    at("2026-10-06T13:00:10Z");
    world.failure = new RpcError(-32602, "project was not found or is hidden");
    let attempts = 0;
    world.beforeCreate = () => void attempts++;
    await expect(tick()).resolves.toEqual({ created: 0 });
    expect(state().r1).toMatchObject({
      last_fired: "2026-10-06T13:00:00.000Z",
      last_task_key: null,
      last_error: "project was not found or is hidden",
    });
    at("2026-10-06T13:00:40Z");
    await tick();
    expect(attempts).toBe(1);

    world.failure = null;
    at("2026-10-07T13:00:10Z");
    await expect(tick()).resolves.toEqual({ created: 1 });
    expect(created.map((task) => task.operation_id)).toEqual(["routine:r1:2026-10-07T13:00:00Z"]);
    expect(state().r1).toMatchObject({ last_task_key: "APP-1", last_error: null });
  });

  it("records the failed session PlaneAI replays when a lost state save makes it retry the operation", async () => {
    const { tick, at, world, created, state, statePath } = harness([
      retro({
        task: {
          ...retro().task,
          start: { enabled: true, provider: "claude", use_worktree: true, auto_approve: true },
        },
      }),
    ]);
    await tick();
    const beforeFiring = readFileSync(statePath, "utf8");
    at("2026-10-06T13:00:10Z");
    await expect(tick()).resolves.toEqual({ created: 1 });
    // The sidecar was killed before its state reached the disk, then the session failed to start.
    writeFileSync(statePath, beforeFiring);
    world.replayed = {
      session: "failed",
      session_error: "failed to create worktree dir: Permission denied (os error 13)",
    };
    at("2026-10-06T13:00:40Z");
    await tick();
    expect(created.map((task) => task.operation_id)).toEqual(["routine:r1:2026-10-06T13:00:00Z"]);
    expect(state().r1).toEqual({
      fingerprint: "0 9 * * 1,2,3,4,5",
      last_fired: "2026-10-06T13:00:00.000Z",
      last_task_key: "APP-1",
      last_error:
        "APP-1 was created, but its session could not start: failed to create worktree dir: Permission denied (os error 13)",
    });
    at("2026-10-06T13:01:10Z");
    await expect(tick()).resolves.toEqual({ created: 0 });
  });

  it("retries the same occurrence while PlaneAI is temporarily unavailable", async () => {
    const { tick, at, world, created, state } = harness();
    await tick();
    at("2026-10-06T13:00:10Z");
    world.failure = new RpcError(-32004, "provider plugin claude-chat is not running yet");
    await expect(tick()).resolves.toEqual({ created: 0 });
    expect(state().r1).toMatchObject({
      last_fired: "2026-10-06T12:00:00.000Z",
      last_error: "provider plugin claude-chat is not running yet",
    });
    world.failure = null;
    at("2026-10-06T13:00:40Z");
    await expect(tick()).resolves.toEqual({ created: 1 });
    expect(created.map((task) => task.operation_id)).toEqual(["routine:r1:2026-10-06T13:00:00Z"]);
    expect(state().r1).toMatchObject({ last_task_key: "APP-1", last_error: null });
  });

  it.each([
    [
      -32003,
      "plugin capability is not granted",
      "PlaneAI did not grant Routines a capability it needs (plugin capability is not granted). Reinstall the plugin.",
    ],
    [
      -32601,
      "host method not found",
      "This PlaneAI cannot create tasks for Routines (host method not found). Update PlaneAI.",
    ],
  ])(
    "skips an occurrence PlaneAI answers with %i, which no retry can fix",
    async (code, message, recorded) => {
      const { tick, at, world, created, state } = harness();
      await tick();
      at("2026-10-06T13:00:10Z");
      world.failure = new RpcError(code, message);
      let attempts = 0;
      world.beforeCreate = () => void attempts++;
      await expect(tick()).resolves.toEqual({ created: 0 });
      at("2026-10-06T13:00:40Z");
      await tick();
      expect(attempts).toBe(1);
      expect(created).toEqual([]);
      expect(state().r1).toMatchObject({
        last_fired: "2026-10-06T13:00:00.000Z",
        last_error: recorded,
      });
    },
  );

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
    world.settings = {
      routines: [retro({ schedule: { kind: "weekly", time: "10:00", weekdays: ["tue"] } })],
    };
    await expect(tick()).resolves.toEqual({ created: 0 });
    expect(created).toEqual([]);
    expect(state().r1).toEqual({
      fingerprint: "0 10 * * 2",
      last_fired: "2026-10-06T15:00:00.000Z",
      last_task_key: null,
      last_error: null,
    });
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
    const { plugin, tick, at, state } = harness([
      retro(),
      retro({ id: "r2", enabled: false }),
      retro({ id: "r3", task: { title: "" } }),
    ]);
    await tick();
    at("2026-10-06T13:00:10Z");
    await tick();
    const before = state();
    at("2026-10-06T13:30:00Z");
    await expect(plugin.handle("routines.status", null)).resolves.toEqual({
      routines: [
        {
          id: "r1",
          next_run: "2026-10-07T13:00:00.000Z",
          last_fired: "2026-10-06T13:00:00.000Z",
          last_task_key: "APP-1",
          error: null,
        },
        { id: "r2", next_run: null, last_fired: null, last_task_key: null, error: null },
        {
          id: "r3",
          next_run: null,
          last_fired: null,
          last_task_key: null,
          error: "Enter a task title.",
        },
      ],
    });
    expect(state()).toEqual(before);
  });

  it("runs a routine now, even a disabled one, without moving its schedule", async () => {
    const { plugin, tick, at, world, created, state } = harness();
    await tick();
    world.settings = { routines: [retro({ enabled: false })] };
    at("2026-10-06T15:30:12.345Z");
    await expect(plugin.handle("routines.runNow", { id: "r1" })).resolves.toEqual({
      task: { key: "APP-1", title: "Retro 2026-10-06" },
      session: "starting",
    });
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
    await expect(plugin.handle("routines.runNow", { id: "nope" })).rejects.toThrow(
      "This routine no longer exists.",
    );
    await expect(plugin.handle("routines.runNow", { id: "r3" })).rejects.toThrow(
      "Enter a task title.",
    );
    await expect(plugin.handle("routines.runNow", {})).rejects.toMatchObject({ code: -32602 });
  });
});
