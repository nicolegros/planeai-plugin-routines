import { join } from "node:path";
import { RoutinesPlugin, type CreatedTask } from "./routines";
import { JsonRpcPeer, RpcError } from "./rpc";
import { StateStore } from "./state";

const dataDir = process.env.PLANEAI_PLUGIN_DATA_DIR;
if (!dataDir) {
  console.error("PLANEAI_PLUGIN_DATA_DIR was not provided by the host");
  process.exit(1);
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RpcError(-32603, `PlaneAI returned malformed ${what}`);
  return value as Record<string, unknown>;
}

let peer: JsonRpcPeer;
const plugin = new RoutinesPlugin(
  {
    settings: async (signal) => object(await peer.request("host.settings.get", null, signal), "settings").settings,
    createTask: async (request, signal) => {
      const created = object(await peer.request("host.tasks.create", request, signal), "a task");
      const task = object(created.task, "a task");
      if (typeof task.key !== "string") throw new RpcError(-32603, "PlaneAI returned a task without a key");
      const session = created.session === "starting" || created.session === "exists" || created.session === "failed" ? created.session : undefined;
      const session_error = typeof created.session_error === "string" ? created.session_error : undefined;
      return { task: task as CreatedTask, ...(session ? { session } : {}), ...(session_error ? { session_error } : {}) };
    },
  },
  new StateStore(join(dataDir, "routines-state.json")),
  () => new Date(),
);
peer = new JsonRpcPeer(process.stdin, process.stdout, async (method, params, signal) => {
  const result = await plugin.handle(method, params, signal);
  // Exit once the acknowledgement has been flushed to the host.
  if (method === "plugin.shutdown") setTimeout(() => process.stdout.write("", () => process.exit(0)), 0);
  return result;
});

console.error("routines starting");
await peer.serve();
