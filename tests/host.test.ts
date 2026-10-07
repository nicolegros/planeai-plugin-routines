import { describe, expect, it } from "vitest";
import { hostOver } from "../src/host";

/** PlaneAI answering every callback with `reply`, recording what the plugin sent. */
function answering(reply: unknown) {
  const sent: [string, unknown][] = [];
  const host = hostOver(async (method, params) => {
    sent.push([method, params]);
    return reply;
  });
  return { host, sent };
}

const request = {
  project_path: "/work/app",
  operation_id: "routine:r1:2026-10-06T13:00:00Z",
  title: "Retro",
  description: "",
  priority: 0,
  tags: [],
};

describe("hostOver", () => {
  it("reads the settings out of PlaneAI's envelope", async () => {
    const { host, sent } = answering({ settings: { routines: [] } });
    await expect(host.settings()).resolves.toEqual({ routines: [] });
    expect(sent).toEqual([["host.settings.get", null]]);
  });

  it("returns the created task with where its session stands", async () => {
    const { host, sent } = answering({
      task: { key: "APP-1", title: "Retro", status: "todo" },
      session: "failed",
      session_error: "Unknown provider: x",
    });
    await expect(host.createTask(request)).resolves.toEqual({
      task: { key: "APP-1", title: "Retro", status: "todo" },
      session: "failed",
      session_error: "Unknown provider: x",
    });
    expect(sent).toEqual([["host.tasks.create", request]]);
  });

  it("leaves out a session state it does not know and a session error that is not text", async () => {
    const { host } = answering({ task: { key: "APP-1" }, session: "queued", session_error: 3 });
    await expect(host.createTask(request)).resolves.toEqual({ task: { key: "APP-1" } });
  });

  it.each([
    [null, "PlaneAI returned malformed a task"],
    [[], "PlaneAI returned malformed a task"],
    [{ task: "APP-1" }, "PlaneAI returned malformed a task"],
    [{ task: { title: "Retro" } }, "PlaneAI returned a task without a key"],
  ])("refuses the malformed reply %j as a host error", async (reply, message) => {
    await expect(answering(reply).host.createTask(request)).rejects.toMatchObject({
      code: -32603,
      message,
    });
  });

  it("refuses settings that are not an object", async () => {
    await expect(answering("settings").host.settings()).rejects.toMatchObject({
      code: -32603,
      message: "PlaneAI returned malformed settings",
    });
  });
});
