import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CANCELLED, JsonRpcPeer, RpcError } from "../src/rpc";

function harness(handler: ConstructorParameters<typeof JsonRpcPeer>[2]) {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: unknown[] = [];
  let buffer = "";
  output.on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      frames.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  const peer = new JsonRpcPeer(input, output, handler);
  void peer.serve();
  const send = (frame: unknown) => input.write(`${JSON.stringify(frame)}\n`);
  return { peer, frames, send };
}

const until = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("JsonRpcPeer", () => {
  it("answers requests and reports handler errors with their codes", async () => {
    const { frames, send } = harness(async (method) => {
      if (method === "fail") throw new RpcError(-32602, "bad params");
      return { ok: method };
    });
    send({ jsonrpc: "2.0", id: 1, method: "ping" });
    send({ jsonrpc: "2.0", id: "two", method: "fail" });
    await until(() => frames.length === 2);
    expect(frames).toContainEqual({ jsonrpc: "2.0", id: 1, result: { ok: "ping" } });
    expect(frames).toContainEqual({
      jsonrpc: "2.0",
      id: "two",
      error: { code: -32602, message: "bad params" },
    });
  });

  it("acknowledges a cancel at once, even when the handler never finishes", async () => {
    let finish: (value: unknown) => void = () => {};
    const { frames, send } = harness(() => new Promise((resolve) => (finish = resolve)));
    send({ jsonrpc: "2.0", id: 8, method: "stuck" });
    send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 8 } });
    await until(() => frames.length === 1);
    expect(frames[0]).toEqual({
      jsonrpc: "2.0",
      id: 8,
      error: { code: CANCELLED, message: "request cancelled" },
    });
    finish("late");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frames).toHaveLength(1);
  });

  it("answers a cancelled request with -32800", async () => {
    const { frames, send } = harness(
      (_, __, signal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve("late"))),
    );
    send({ jsonrpc: "2.0", id: 7, method: "slow" });
    send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 7 } });
    await until(() => frames.length === 1);
    expect(frames[0]).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: CANCELLED, message: "request cancelled" },
    });
  });

  it("answers an oversized result with an error instead of leaving the host waiting", async () => {
    const { frames, send } = harness(async () => "x".repeat(70_000));
    send({ jsonrpc: "2.0", id: 3, method: "big" });
    await until(() => frames.length === 1);
    expect(frames[0]).toMatchObject({
      id: 3,
      error: { code: -32000, message: expect.stringContaining("frame limit") },
    });
  });

  it("correlates its own requests to the host's responses, in any order", async () => {
    const { peer, frames, send } = harness(async () => null);
    const settings = peer.request("host.settings.get", null);
    const projects = peer.request("host.projects.list", null);
    await until(() => frames.length === 2);
    expect(frames).toEqual([
      { jsonrpc: "2.0", id: "routines-1", method: "host.settings.get", params: null },
      { jsonrpc: "2.0", id: "routines-2", method: "host.projects.list", params: null },
    ]);
    send({ jsonrpc: "2.0", id: "routines-2", result: { projects: [] } });
    send({ jsonrpc: "2.0", id: "routines-1", result: { settings: { routines: [] } } });
    await expect(projects).resolves.toEqual({ projects: [] });
    await expect(settings).resolves.toEqual({ settings: { routines: [] } });
  });

  it("rejects a request the host answers with an error, keeping its code", async () => {
    const { peer, frames, send } = harness(async () => null);
    const creating = peer.request("host.tasks.create", { title: "t" });
    await until(() => frames.length === 1);
    send({
      jsonrpc: "2.0",
      id: "routines-1",
      error: { code: -32601, message: "unknown host method" },
    });
    await expect(creating).rejects.toMatchObject({ code: -32601, message: "unknown host method" });
  });

  it("serves host requests while its own request is pending", async () => {
    const { peer, frames, send } = harness(async (method) => ({ ok: method }));
    const settings = peer.request("host.settings.get", null);
    send({ jsonrpc: "2.0", id: 4, method: "routines.status" });
    await until(() => frames.length === 2);
    expect(frames[1]).toEqual({ jsonrpc: "2.0", id: 4, result: { ok: "routines.status" } });
    send({ jsonrpc: "2.0", id: "routines-1", result: { settings: {} } });
    await expect(settings).resolves.toEqual({ settings: {} });
  });

  it("abandons a request when its signal aborts and ignores the late answer", async () => {
    const { peer, frames, send } = harness(async () => null);
    const controller = new AbortController();
    const creating = peer.request("host.tasks.create", {}, controller.signal);
    await until(() => frames.length === 1);
    controller.abort();
    await expect(creating).rejects.toMatchObject({ code: CANCELLED });
    send({ jsonrpc: "2.0", id: "routines-1", result: { task: { key: "A-1" } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(peer.request("host.tasks.create", {}, AbortSignal.abort())).rejects.toMatchObject({
      code: CANCELLED,
    });
    expect(frames).toHaveLength(1);
  });

  it("refuses to send a request over the frame limit", async () => {
    const { peer, frames } = harness(async () => null);
    await expect(peer.request("host.tasks.create", { title: "x".repeat(70_000) })).rejects.toThrow(
      "frame limit",
    );
    expect(frames).toHaveLength(0);
  });
});
