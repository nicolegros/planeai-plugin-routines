import { readFileSync, renameSync, writeFileSync } from "node:fs";

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

  save(state: RunState): void {
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temporary, this.path);
  }
}
