import { join } from "node:path";
import { hostOver } from "./host";
import { RoutinesPlugin } from "./routines";
import { JsonRpcPeer } from "./rpc";
import { StateStore } from "./state";

const dataDir = process.env.PLANEAI_PLUGIN_DATA_DIR;
if (!dataDir) {
  console.error("PLANEAI_PLUGIN_DATA_DIR was not provided by the host");
  process.exit(1);
}

let peer: JsonRpcPeer;
const plugin = new RoutinesPlugin(
  hostOver((method, params, signal) => peer.request(method, params, signal)),
  new StateStore(join(dataDir, "routines-state.json")),
  () => new Date(),
);
peer = new JsonRpcPeer(process.stdin, process.stdout, async (method, params, signal) => {
  const result = await plugin.handle(method, params, signal);
  // Exit once the acknowledgement has been flushed to the host.
  if (method === "plugin.shutdown")
    setTimeout(() => process.stdout.write("", () => process.exit(0)), 0);
  return result;
});

console.error("routines starting");
await peer.serve();
