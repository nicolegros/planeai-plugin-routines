import type { RoutineStatus, TaskCreation } from "../src/routines";

export interface Project {
  id: string;
  name: string;
  path: string;
}

/** The slice of PlaneAI's local plugin UI bridge the Routines dialog uses. */
export interface RoutinesUiContext {
  host: {
    /** This plugin's sidecar. */
    call<T>(method: string, params?: unknown): Promise<T>;
    /** PlaneAI's own data RPC, checked against the manifest's capabilities. */
    rpc: { call<T>(method: string, params?: unknown): Promise<T> };
    settings: {
      get<T extends Record<string, unknown>>(): Promise<T>;
      replace<T extends Record<string, unknown>>(settings: T): Promise<T>;
    };
    data: {
      notify(message: string, kind?: "success" | "error" | "info" | "warning"): void;
      /** Called after each background check, and whenever another view changes the plugin's data. */
      onChanged(listener: () => void): () => void;
    };
  };
}

export type { RoutineStatus, TaskCreation };

/** The slice of the bridge the sidebar button uses. */
export interface SidebarUiContext {
  host: {
    settings: { get<T extends Record<string, unknown>>(): Promise<T> };
    navigation: { open(pluginId: string, contributionId: string): void };
    /** Absent on hosts that predate change notifications. */
    data: { onChanged?(listener: () => void): () => void };
  };
}
