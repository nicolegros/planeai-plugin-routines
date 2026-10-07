import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** PlaneAI rejects frames over 64 KiB, newline included. */
export const MAX_FRAME_BYTES = 64 * 1024;
export const CANCELLED = -32800;

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export type Handler = (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>;

type Id = string | number;
type Frame = { jsonrpc: "2.0"; id?: Id } & Record<string, unknown>;

type Pending = { resolve: (result: unknown) => void; reject: (error: RpcError) => void };

/**
 * Newline-framed JSON-RPC 2.0 over stdio, as the PlaneAI plugin host speaks it.
 * Requests run concurrently; `$/cancelRequest` aborts the matching handler.
 * The sidecar's own requests to the host carry string ids, so they never collide with the host's.
 */
export class JsonRpcPeer {
  private readonly inFlight = new Map<Id, AbortController>();
  private readonly outgoing = new Map<string, Pending>();
  private nextId = 0;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly handler: Handler,
  ) {}

  /** Resolves when stdin closes. */
  async serve(): Promise<void> {
    const lines = createInterface({ input: this.input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      this.dispatch(line);
    }
    for (const [id, pending] of this.outgoing) {
      this.outgoing.delete(id);
      pending.reject(new RpcError(-32000, "the host closed the connection"));
    }
  }

  /** Calls the host. PlaneAI serves callbacks only while it waits on one of its own requests, whose signal this takes. */
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const cancelled = () => new RpcError(CANCELLED, "request cancelled");
      if (signal?.aborted) return reject(cancelled());
      const id = `routines-${++this.nextId}`;
      if (!this.send({ jsonrpc: "2.0", id, method, params })) {
        return reject(
          new RpcError(-32000, `request exceeds the ${MAX_FRAME_BYTES}-byte frame limit`),
        );
      }
      // PlaneAI may never answer a callback of a request it gave up on, so the abort settles it.
      const abort = () => {
        this.outgoing.delete(id);
        reject(cancelled());
      };
      signal?.addEventListener("abort", abort, { once: true });
      const done = () => signal?.removeEventListener("abort", abort);
      this.outgoing.set(id, {
        resolve: (result) => (done(), resolve(result)),
        reject: (error) => (done(), reject(error)),
      });
    });
  }

  private dispatch(line: string): void {
    let message: {
      id?: Id;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      console.error(`ignored malformed JSON-RPC frame: ${String(error)}`);
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error(`ignored JSON-RPC frame that is not an object: ${line.trim()}`);
      return;
    }
    message = parsed;
    if (message.method === undefined) {
      const pending = typeof message.id === "string" ? this.outgoing.get(message.id) : undefined;
      if (!pending) return;
      this.outgoing.delete(message.id as string);
      if (message.error) {
        const { code, message: text } = message.error;
        pending.reject(
          new RpcError(
            typeof code === "number" ? code : -32603,
            typeof text === "string" ? text : "host error",
          ),
        );
      } else {
        pending.resolve(message.result ?? null);
      }
      return;
    }
    if (message.method === "$/cancelRequest") {
      const id = (message.params as { id?: Id } | undefined)?.id;
      const controller = id === undefined ? undefined : this.inFlight.get(id);
      if (id === undefined || !controller) return;
      // Acknowledge at once: the host stops a sidecar that misses its cancel deadline,
      // and a handler blocked on the host may never notice the abort.
      this.inFlight.delete(id);
      controller.abort();
      this.write({ jsonrpc: "2.0", id, error: { code: CANCELLED, message: "request cancelled" } });
      return;
    }
    if (typeof message.method !== "string" || message.id === undefined) return;
    const id = message.id;
    const controller = new AbortController();
    this.inFlight.set(id, controller);
    const answer = (frame: Frame) => {
      // A cancelled request was already answered; its late result is dropped.
      if (this.inFlight.get(id) !== controller) return;
      this.inFlight.delete(id);
      this.write(frame);
    };
    void this.handler(message.method, message.params ?? null, controller.signal).then(
      (result) => answer({ jsonrpc: "2.0", id, result: result ?? null }),
      (error: unknown) => {
        const code = error instanceof RpcError ? error.code : -32000;
        answer({
          jsonrpc: "2.0",
          id,
          error: { code, message: error instanceof Error ? error.message : String(error) },
        });
      },
    );
  }

  /** Writes the frame when it fits PlaneAI's limit. */
  private send(frame: Frame): boolean {
    const line = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES) return false;
    this.output.write(line);
    return true;
  }

  private write(frame: Frame): void {
    if (this.send(frame)) return;
    console.error(`JSON-RPC frame over ${MAX_FRAME_BYTES} bytes not sent`);
    // A response must still answer its request, or the host waits out its deadline.
    if (frame.id !== undefined) {
      this.write({
        jsonrpc: "2.0",
        id: frame.id,
        error: {
          code: -32000,
          message: `response exceeds the ${MAX_FRAME_BYTES}-byte frame limit`,
        },
      });
    }
  }
}
