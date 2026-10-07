import type { CreatedTask, Host } from "./routines";
import { RpcError } from "./rpc";

/** Sends one callback to PlaneAI and resolves with its result. */
export type HostRequest = (
  method: string,
  params: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;

function object(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RpcError(-32603, `PlaneAI returned malformed ${what}`);
  return value as Record<string, unknown>;
}

/** The PlaneAI callbacks the plugin makes, parsing each reply at the boundary. */
export function hostOver(request: HostRequest): Host {
  return {
    settings: async (signal) =>
      object(await request("host.settings.get", null, signal), "settings").settings,
    createTask: async (task, signal) => {
      const created = object(await request("host.tasks.create", task, signal), "a task");
      const reply = object(created.task, "a task");
      if (typeof reply.key !== "string")
        throw new RpcError(-32603, "PlaneAI returned a task without a key");
      const session =
        created.session === "starting" ||
        created.session === "exists" ||
        created.session === "failed"
          ? created.session
          : undefined;
      const session_error =
        typeof created.session_error === "string" ? created.session_error : undefined;
      return {
        task: reply as CreatedTask,
        ...(session ? { session } : {}),
        ...(session_error ? { session_error } : {}),
      };
    },
  };
}
