import { readFileSync } from "node:fs";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarUiContext } from "../ui/host";
import entrypoint from "../ui/sidebar";

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flushSync();
};

const routine = (id: string, enabled: boolean, schedule: Record<string, unknown>) => ({
  id,
  name: id,
  enabled,
  project_path: "/work/app",
  schedule,
  task: { title: "Task", description: "", priority: 0, tags: [] },
});

function harness(settings: () => Promise<unknown>) {
  const changeListeners = new Set<() => void>();
  const context: SidebarUiContext = {
    host: {
      settings: { get: settings as SidebarUiContext["host"]["settings"]["get"] },
      navigation: { open: vi.fn() },
      data: {
        onChanged: (listener) => {
          changeListeners.add(listener);
          return () => changeListeners.delete(listener);
        },
      },
    },
  };
  return { context, open: context.host.navigation.open as ReturnType<typeof vi.fn>, changeListeners };
}

const button = () => document.querySelector("button")!;
const label = () => button().querySelector("[data-label]")?.textContent;
const hint = () => button().querySelector("[data-hint]")?.textContent ?? null;

describe("the sidebar button", () => {
  let dispose: (() => void) | null = null;

  async function render(context: SidebarUiContext): Promise<void> {
    dispose = entrypoint.mount(document.body, context);
    await settle();
  }

  beforeEach(() => {
    // Tuesday, 08:00 in America/Toronto.
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z"), toFake: ["Date", "setInterval", "clearInterval"] });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("shows the time of today's next run among enabled routines", async () => {
    const { context } = harness(async () => ({
      routines: [
        routine("weekdays", true, { kind: "weekly", time: "09:00", weekdays: ["mon", "tue", "wed", "thu", "fri"] }),
        routine("earlier but off", false, { kind: "weekly", time: "08:30", weekdays: ["tue"] }),
      ],
    }));
    await render(context);
    expect(label()).toBe("Routines");
    expect(button().getAttribute("aria-label")).toBe("Routines");
    expect(hint()).toBe("09:00");
  });

  it("names the weekday of a run later this week and the date of one further out", async () => {
    let routines = [routine("mondays", true, { kind: "weekly", time: "09:00", weekdays: ["mon"] })];
    const { context } = harness(async () => ({ routines }));
    await render(context);
    expect(hint()).toBe("Mon 09:00");

    routines = [routine("monthly", true, { kind: "monthly", time: "07:15", day: 20 })];
    vi.advanceTimersByTime(30_000);
    await settle();
    expect(hint()).toBe("Oct 20 07:15");
  });

  it("shows no time without an enabled routine", async () => {
    const { context } = harness(async () => ({ routines: [routine("off", false, { kind: "weekly", time: "09:00", weekdays: ["tue"] })] }));
    await render(context);
    expect(label()).toBe("Routines");
    expect(hint()).toBe(null);
  });

  it("shows no time when the settings cannot be read", async () => {
    const { context } = harness(async () => {
      throw new Error("settings capability is not granted");
    });
    await render(context);
    expect(label()).toBe("Routines");
    expect(hint()).toBe(null);
  });

  it("refreshes when PlaneAI reports a change", async () => {
    let routines: unknown[] = [];
    const { context, changeListeners } = harness(async () => ({ routines }));
    await render(context);
    expect(hint()).toBe(null);

    routines = [routine("daily", true, { kind: "weekly", time: "17:45", weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] })];
    for (const listener of changeListeners) listener();
    await settle();
    expect(hint()).toBe("17:45");

    dispose?.();
    dispose = null;
    expect(changeListeners.size).toBe(0);
  });

  it("opens the Routines dialog", async () => {
    const { context, open } = harness(async () => ({ routines: [] }));
    await render(context);
    button().click();
    expect(open).toHaveBeenCalledExactlyOnceWith("routines", "routines");
  });
});

describe("the manifest", () => {
  it("contributes the manager as a host dialog", () => {
    const manifest = JSON.parse(readFileSync("planeai-plugin.json", "utf8"));
    expect(manifest.ui_contributions).toContainEqual({ id: "routines", label: "Routines", placement: "dialog", entrypoint: "ui/routines.js" });
  });

  it("contributes the sidebar button above the sidebar", () => {
    const manifest = JSON.parse(readFileSync("planeai-plugin.json", "utf8"));
    expect(manifest.ui_contributions).toContainEqual({ id: "open", label: "Routines", placement: "sidebar.header", entrypoint: "ui/sidebar.js", order: 0 });
  });
});
