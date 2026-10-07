import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replaceFile, StateStore } from "../src/state";

const store = () => {
  const dir = mkdtempSync(join(tmpdir(), "routines-state-"));
  return {
    dir,
    path: join(dir, "routines-state.json"),
    store: new StateStore(join(dir, "routines-state.json")),
  };
};

const entry = {
  fingerprint: "0 9 * * 1",
  last_fired: "2026-10-05T13:00:00.000Z",
  last_task_key: "APP-12",
  last_error: null,
};

describe("StateStore", () => {
  it("starts empty and reads back what it saved, leaving no temporary file", () => {
    const { dir, path, store: state } = store();
    expect(state.load()).toEqual({});
    state.save({ r1: entry });
    expect(state.load()).toEqual({ r1: entry });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ r1: entry });
    expect(readdirSync(dir)).toEqual(["routines-state.json"]);
  });

  it("drops entries it cannot trust and survives a corrupt file", () => {
    const { path, store: state } = store();
    writeFileSync(
      path,
      JSON.stringify({
        r1: entry,
        r2: { ...entry, last_fired: "yesterday" },
        r3: { fingerprint: 3 },
        r4: "x",
      }),
    );
    expect(state.load()).toEqual({ r1: entry });
    writeFileSync(path, "{not json");
    expect(state.load()).toEqual({});
  });

  it("removes its temporary file when the replace fails", () => {
    const { dir, path, store: state } = store();
    mkdirSync(path);
    writeFileSync(join(path, "occupied"), "");
    expect(() => state.save({ r1: entry })).toThrow();
    expect(readdirSync(dir)).toEqual(["routines-state.json"]);
  });
});

describe("replaceFile", () => {
  const failing = (codes: string[]) => {
    const calls: [string, string][] = [];
    const rename = (from: string, to: string) => {
      calls.push([from, to]);
      const code = codes.shift();
      if (code) throw Object.assign(new Error(code), { code });
    };
    return { calls, rename };
  };

  it("retries a replace Windows refuses while another process holds the file", () => {
    const { calls, rename } = failing(["EPERM", "EBUSY"]);
    replaceFile("state.tmp", "state.json", { rename, transient: new Set(["EPERM", "EBUSY"]) });
    expect(calls).toEqual([
      ["state.tmp", "state.json"],
      ["state.tmp", "state.json"],
      ["state.tmp", "state.json"],
    ]);
  });

  it("gives up on a failure that is not transient, and after a bounded number of retries", () => {
    const missing = failing(["ENOENT"]);
    expect(() =>
      replaceFile("state.tmp", "state.json", {
        rename: missing.rename,
        transient: new Set(["EPERM"]),
      }),
    ).toThrow("ENOENT");
    expect(missing.calls).toHaveLength(1);
    const held = failing(Array(20).fill("EPERM"));
    expect(() =>
      replaceFile("state.tmp", "state.json", {
        rename: held.rename,
        transient: new Set(["EPERM"]),
      }),
    ).toThrow("EPERM");
    expect(held.calls).toHaveLength(5);
  });
});
