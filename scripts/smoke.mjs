import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Plays PlaneAI against the staged sidecar: a routine whose last run was two days ago is due,
// so one tick must create exactly one task for today's occurrence, ask for its session, and record it.
const [packageRoot, platform] = process.argv.slice(2);
if (!packageRoot || !platform) throw new Error("usage: node scripts/smoke.mjs <package-root> <platform>");

const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "planeai-plugin.json"), "utf8"));
const binaryPath = path.join(packageRoot, manifest.backend_entrypoints[platform]);

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planeai-plugin-smoke-"));
const dataDir = path.join(stateRoot, "data");
for (const directory of ["data", "secrets"]) fs.mkdirSync(path.join(stateRoot, directory));
process.on("exit", () => fs.rmSync(stateRoot, { recursive: true, force: true }));

const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const settings = {
  tick_interval_ms: 30_000,
  routines: [
    {
      id: "smoke",
      name: "Smoke",
      enabled: true,
      project_path: "/work/app",
      schedule: { kind: "weekly", time: "00:00", weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] },
      task: {
        title: "Smoke {{date}}",
        description: "Created by {{routine}}",
        priority: 2,
        tags: ["smoke"],
        start: { enabled: true, provider: "claude", use_worktree: true, auto_approve: false },
      },
    },
  ],
};
const statePath = path.join(dataDir, "routines-state.json");
fs.writeFileSync(
  statePath,
  JSON.stringify({ smoke: { fingerprint: "0 0 * * *", last_fired: new Date(today.getTime() - 2 * 86_400_000).toISOString(), last_task_key: null, last_error: null } }),
);

const child = spawn(binaryPath, [], {
  stdio: ["pipe", "pipe", "pipe"],
  // UTC makes today's midnight the expected occurrence.
  env: { ...process.env, TZ: "UTC", PLANEAI_PLUGIN_DATA_DIR: dataDir, PLANEAI_PLUGIN_SECRETS_DIR: path.join(stateRoot, "secrets") },
});
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += chunk));

const frames = [];
const waiting = [];
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const frame = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    const next = waiting.shift();
    if (next) next(frame);
    else frames.push(frame);
  }
});
const receive = () =>
  new Promise((resolve, reject) => {
    if (frames.length) return resolve(frames.shift());
    const timer = setTimeout(() => reject(new Error(`timed out waiting for the sidecar\n${stderr}`)), 5_000);
    waiting.push((frame) => {
      clearTimeout(timer);
      resolve(frame);
    });
  });
const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);

/** A host request, serving the sidecar's callbacks with `callbacks` until the response arrives. */
async function request(id, method, callbacks = {}) {
  send({ jsonrpc: "2.0", id, method, params: method === "plugin.handshake" ? { host_api_version: manifest.host_api_version, host_capabilities: manifest.capabilities } : null });
  const served = [];
  for (;;) {
    const frame = await receive();
    if (frame.method === undefined) {
      assert.equal(frame.id, id, "response correlates with the request");
      return { response: frame, served };
    }
    const answer = callbacks[frame.method];
    assert.ok(answer, `unexpected callback ${frame.method}`);
    served.push(frame);
    send({ jsonrpc: "2.0", id: frame.id, ...answer(frame.params) });
  }
}

const settingsCallback = { "host.settings.get": () => ({ result: { settings } }) };

try {
  const handshake = await request(1, "plugin.handshake");
  assert.equal(handshake.response.result.plugin_id, manifest.id);

  const due = await request(2, "routines.tick", {
    ...settingsCallback,
    "host.tasks.create": () => ({ result: { task: { key: "SMK-1", title: "Smoke" }, session: "starting" } }),
  });
  assert.deepEqual(due.response.result, { created: 1 });
  const occurrence = today.toISOString();
  const create = due.served.find((frame) => frame.method === "host.tasks.create");
  assert.deepEqual(create.params, {
    project_path: "/work/app",
    operation_id: `routine:smoke:${occurrence.replace(".000Z", "Z")}`,
    title: `Smoke ${occurrence.slice(0, 10)}`,
    description: "Created by Smoke",
    priority: 2,
    tags: ["smoke"],
    start: { provider: "claude", use_worktree: true, auto_approve: false },
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), {
    smoke: { fingerprint: "0 0 * * *", last_fired: occurrence, last_task_key: "SMK-1", last_error: null },
  });

  const idle = await request(3, "routines.tick", settingsCallback);
  assert.deepEqual(idle.response.result, { created: 0 });
  assert.deepEqual(idle.served.map((frame) => frame.method), ["host.settings.get"]);

  const shutdown = await request(4, "plugin.shutdown");
  assert.deepEqual(shutdown.response.result, { stopping: true });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, "the sidecar exits after shutdown");
  console.log(`smoke: one due routine created ${create.params.operation_id} with a ${create.params.start.provider} session and recorded SMK-1 for ${platform}`);
} catch (error) {
  child.kill();
  console.error(error.message);
  if (stderr) console.error(stderr.trim());
  process.exitCode = 1;
}
