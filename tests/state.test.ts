import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state";

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
});
