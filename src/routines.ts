import { parseRoutines, type Routine } from "./routine";
import { RpcError } from "./rpc";
import { latestOccurrence, nextRun, toCron } from "./schedule";
import type { RoutineState, RunState, StateStore } from "./state";
import { render } from "./template";

export const PLUGIN_ID = "routines";
export const PLUGIN_NAME = "Routines";
export const HOST_API_VERSION = "planeai.plugin-host.v4";
/** Replaced by scripts/inject-release-version.mjs in release builds. */
export const PLUGIN_VERSION = "0.0.0";

const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;

/**
 * `host.tasks.create` params; PlaneAI dedupes on (plugin, operation_id). With `start`, it also
 * starts the task's session in the background, once, unless the task already has one.
 */
export interface TaskRequest {
  project_path: string;
  operation_id: string;
  title: string;
  description: string;
  priority: number;
  tags: string[];
  start?: { provider: string | null; use_worktree: boolean; auto_approve: boolean };
}

export interface CreatedTask {
  key: string;
  [field: string]: unknown;
}

/** `session` is set only when the request asked for a start; `session_error` when it failed. */
export interface TaskCreation {
  task: CreatedTask;
  session?: "starting" | "exists" | "failed";
  session_error?: string;
}

/** The PlaneAI callbacks the plugin makes, each within the host request whose signal it is given. */
export interface Host {
  settings(signal?: AbortSignal): Promise<unknown>;
  createTask(request: TaskRequest, signal?: AbortSignal): Promise<TaskCreation>;
}

export interface RoutineStatus {
  id: string;
  next_run: string | null;
  last_fired: string | null;
  last_task_key: string | null;
  error: string | null;
}

function taskRequest(routine: Routine, at: Date, operation_id: string): TaskRequest {
  const context = { at, routine: routine.name };
  const { enabled, provider, use_worktree, auto_approve } = routine.task.start;
  return {
    project_path: routine.project_path,
    operation_id,
    title: render(routine.task.title, context),
    description: render(routine.task.description, context),
    priority: routine.task.priority,
    tags: routine.task.tags,
    ...(enabled ? { start: { provider, use_worktree, auto_approve } } : {}),
  };
}

/** Occurrences fall on whole minutes, so their ids carry no milliseconds. */
const occurrenceId = (routine: Routine, at: Date) =>
  `routine:${routine.id}:${at.toISOString().replace(".000Z", "Z")}`;

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RoutinesPlugin {
  /** Ticks run one after another: a tick the host gave up on may still be finishing. */
  private ticking: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly host: Host,
    private readonly store: StateStore,
    private readonly now: () => Date,
  ) {}

  async handle(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    switch (method) {
      case "plugin.handshake":
        return {
          plugin_id: PLUGIN_ID,
          plugin_name: PLUGIN_NAME,
          plugin_version: PLUGIN_VERSION,
          host_api_version: HOST_API_VERSION,
          lifecycle_event_subscriptions: [],
        };
      case "plugin.shutdown":
        return { stopping: true };
      case "routines.tick": {
        const run = this.ticking.then(() => this.tick(signal));
        this.ticking = run.catch(() => {});
        return await run;
      }
      case "routines.status":
        return await this.status(signal);
      case "routines.runNow":
        return await this.runNow(params, signal);
      default:
        throw new RpcError(METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }

  private async tick(signal?: AbortSignal): Promise<{ created: number }> {
    const { routines } = parseRoutines(await this.host.settings(signal));
    const previous = this.store.load();
    const now = this.now();
    // Built from the settings alone, so disabled, invalid and deleted routines lose their state.
    const next: RunState = {};
    let created = 0;
    for (const routine of routines) {
      if (!routine.enabled) continue;
      const state = previous[routine.id];
      if (signal?.aborted) {
        if (state) next[routine.id] = state;
        continue;
      }
      const step = await this.advance(routine, state, now, signal);
      next[routine.id] = step.state;
      if (step.created) created++;
    }
    if (JSON.stringify(next) !== JSON.stringify(previous)) this.store.save(next);
    return { created };
  }

  /** One routine's step: rebaseline, wait, or create the latest due occurrence. */
  private async advance(
    routine: Routine,
    state: RoutineState | undefined,
    now: Date,
    signal?: AbortSignal,
  ): Promise<{ state: RoutineState; created: boolean }> {
    const fingerprint = toCron(routine.schedule);
    if (!state || state.fingerprint !== fingerprint) {
      return {
        state: {
          fingerprint,
          last_fired: now.toISOString(),
          last_task_key: state?.last_task_key ?? null,
          last_error: null,
        },
        created: false,
      };
    }
    const due = latestOccurrence(routine.schedule, new Date(state.last_fired), now);
    if (!due) return { state, created: false };
    try {
      const { task, session, session_error } = await this.host.createTask(
        taskRequest(routine, due, occurrenceId(routine, due)),
        signal,
      );
      const last_error =
        session === "failed"
          ? `${task.key} was created, but its session could not start: ${session_error ?? "unknown error"}`
          : null;
      return {
        state: { fingerprint, last_fired: due.toISOString(), last_task_key: task.key, last_error },
        created: true,
      };
    } catch (error) {
      // PlaneAI refused this occurrence for good: retrying it cannot succeed, the next one may.
      if (error instanceof RpcError && error.code === INVALID_PARAMS) {
        return {
          state: { ...state, last_fired: due.toISOString(), last_error: failure(error) },
          created: false,
        };
      }
      // last_fired stays, so the next tick retries the same operation id.
      return { state: { ...state, last_error: failure(error) }, created: false };
    }
  }

  private async status(signal?: AbortSignal): Promise<{ routines: RoutineStatus[] }> {
    const { routines, problems } = parseRoutines(await this.host.settings(signal));
    const state = this.store.load();
    const now = this.now();
    return {
      routines: [
        ...routines.map((routine) => {
          const known = routine.enabled ? state[routine.id] : undefined;
          return {
            id: routine.id,
            next_run: routine.enabled
              ? (nextRun(routine.schedule, now)?.toISOString() ?? null)
              : null,
            last_fired: known?.last_fired ?? null,
            last_task_key: known?.last_task_key ?? null,
            error: known?.last_error ?? null,
          };
        }),
        ...[...problems].map(([id, error]) => ({
          id,
          next_run: null,
          last_fired: null,
          last_task_key: null,
          error,
        })),
      ],
    };
  }

  private async runNow(params: unknown, signal?: AbortSignal): Promise<TaskCreation> {
    const id =
      typeof params === "object" && params !== null
        ? (params as Record<string, unknown>).id
        : undefined;
    if (typeof id !== "string" || !id)
      throw new RpcError(INVALID_PARAMS, "id must be a nonempty string");
    const { routines, problems } = parseRoutines(await this.host.settings(signal));
    const problem = problems.get(id);
    if (problem) throw new RpcError(INVALID_PARAMS, problem);
    const routine = routines.find((candidate) => candidate.id === id);
    if (!routine) throw new RpcError(INVALID_PARAMS, "This routine no longer exists.");
    const now = this.now();
    try {
      return await this.host.createTask(
        taskRequest(routine, now, `routine:${id}:manual:${now.toISOString()}`),
        signal,
      );
    } catch (error) {
      throw new RpcError(error instanceof RpcError ? error.code : -32000, failure(error));
    }
  }
}
