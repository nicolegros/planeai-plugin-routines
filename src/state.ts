import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

/** What the sidecar remembers about one routine between ticks. */
export interface RoutineState {
  /** The canonical cron string the state was recorded for; a change rebaselines the routine. */
  fingerprint: string;
  /** ISO instant of the last occurrence handled, or of the rebaseline. */
  last_fired: string;
  last_task_key: string | null;
  last_error: string | null;
}

export type RunState = Record<string, RoutineState>;

const nullableText = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

function isRoutineState(value: unknown): value is RoutineState {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.fingerprint === "string" &&
    typeof entry.last_fired === "string" &&
    !Number.isNaN(Date.parse(entry.last_fired)) &&
    nullableText(entry.last_task_key) &&
    nullableText(entry.last_error)
  );
}

/**
 * Run state owned by the sidecar alone; the UI never writes it, and PlaneAI's settings file
 * is never touched here. Writes replace the file atomically.
 */
export class StateStore {
  constructor(private readonly path: string) {}

  load(): RunState {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error(`ignored unreadable run state: ${String(error)}`);
      return {};
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, RoutineState] =>
        isRoutineState(entry[1]),
      ),
    );
  }

  /** Durable once it returns: the file is flushed before it replaces the old one, and the directory after. */
  save(state: RunState): void {
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      const file = openSync(temporary, "w");
      try {
        writeSync(file, `${JSON.stringify(state, null, 2)}\n`);
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      replaceFile(temporary, this.path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    flushDirectory(dirname(this.path));
  }
}

/** Windows refuses a replace while another process, such as an antivirus scan, briefly holds the file open. */
const WINDOWS_TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);
const REPLACE_ATTEMPTS = 5;

export function replaceFile(
  from: string,
  to: string,
  {
    rename = renameSync as (from: string, to: string) => void,
    transient = process.platform === "win32" ? WINDOWS_TRANSIENT : new Set<string>(),
  } = {},
): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt === REPLACE_ATTEMPTS || !transient.has(code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 20);
    }
  }
}

/** Makes the rename itself durable; Windows cannot open a directory for this, and NTFS journals the rename. */
function flushDirectory(directory: string): void {
  if (process.platform === "win32") return;
  try {
    const handle = openSync(directory, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  } catch (error) {
    console.error(`could not flush ${directory}: ${String(error)}`);
  }
}
