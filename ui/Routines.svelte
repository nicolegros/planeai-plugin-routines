<script lang="ts">
  import { onMount, tick } from "svelte";
  import { checkRoutine, parseRoutines, routineKey, type Routine } from "../src/routine";
  import { newDraft, newId, toDraft, toEntry, type Draft } from "./draft";
  import type { Project, RoutineStatus, RoutinesUiContext, TaskCreation } from "./host";
  import type { SessionProviders } from "./providers";
  import RoutineEditor from "./RoutineEditor.svelte";
  import RoutineRow from "./RoutineRow.svelte";

  let { context }: { context: RoutinesUiContext } = $props();

  const REFRESH_MS = 30_000;

  /** The whole settings document; keys other than `routines` belong to PlaneAI or other features and are written back untouched. */
  let settings = $state<Record<string, unknown> | null>(null);
  let loadFailure = $state<string | null>(null);
  let projects = $state<Project[] | null>(null);
  let projectsFailure = $state<string | null>(null);
  let providers = $state<SessionProviders | null>(null);
  let providersFailure = $state<string | null>(null);
  let statuses = $state<Record<string, RoutineStatus>>({});
  let statusFailure = $state<string | null>(null);
  let now = $state(new Date());
  let editing = $state<{ draft: Draft; isNew: boolean } | null>(null);
  let running = $state<Record<string, boolean>>({});
  /** Saves run one after another, so each writes the document the previous one left. */
  let saving: Promise<unknown> = Promise.resolve();

  const entries = $derived<unknown[]>(Array.isArray(settings?.routines) ? settings.routines : []);
  const parsed = $derived(parseRoutines(settings));
  const byId = $derived(new Map(parsed.routines.map((routine) => [routine.id, routine])));
  const rows = $derived(
    entries.map((entry, index) => {
      const key = routineKey(entry, index);
      return { key, entry, routine: parsed.problems.has(key) ? undefined : byId.get(key), problem: parsed.problems.get(key) ?? null };
    }),
  );

  const describeError = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

  async function load(): Promise<void> {
    loadFailure = null;
    try {
      settings = await context.host.settings.get();
    } catch (reason) {
      loadFailure = `Could not load routines: ${describeError(reason)}`;
    }
  }

  async function loadProjects(): Promise<void> {
    projectsFailure = null;
    try {
      projects = (await context.host.rpc.call<{ projects: Project[] }>("projects.list")).projects;
    } catch (reason) {
      projectsFailure = `Could not load projects: ${describeError(reason)}`;
    }
  }

  async function loadProviders(): Promise<void> {
    providersFailure = null;
    try {
      providers = await context.host.rpc.call<SessionProviders>("sessions.providers");
    } catch (reason) {
      providersFailure = `Could not load providers: ${describeError(reason)}`;
    }
  }

  async function refreshStatus(): Promise<void> {
    now = new Date();
    try {
      const result = await context.host.call<{ routines: RoutineStatus[] }>("routines.status");
      statuses = Object.fromEntries(result.routines.map((status) => [status.id, status]));
      statusFailure = null;
    } catch (reason) {
      statusFailure = `Run times are unavailable: ${describeError(reason)}`;
    }
  }

  onMount(() => {
    void load();
    void loadProjects();
    void loadProviders();
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), REFRESH_MS);
    return () => clearInterval(timer);
  });

  function save(next: unknown[]): void {
    const document = { ...settings, routines: next };
    settings = document;
    saving = saving.then(async () => {
      try {
        await context.host.settings.replace(document);
      } catch (reason) {
        context.host.data.notify(`Could not save routines: ${describeError(reason)}`, "error");
        await load();
        return;
      }
      await refreshStatus();
    });
  }

  async function focus(selector: string): Promise<void> {
    await tick();
    document.querySelector<HTMLElement>(selector)?.focus();
  }

  function create(): void {
    editing = { draft: newDraft(newId(), projects?.[0]?.path ?? ""), isNew: true };
  }

  function edit(routine: Routine): void {
    editing = { draft: toDraft(routine), isNew: false };
  }

  function closeEditor(): void {
    const id = editing && !editing.isNew ? editing.draft.id : null;
    editing = null;
    void focus(id ? `[data-edit="${CSS.escape(id)}"]` : "[data-new-routine]");
  }

  function submit(draft: Draft): void {
    const entry = toEntry(draft);
    if (!("routine" in checkRoutine(entry))) return;
    const index = entries.findIndex((candidate, position) => routineKey(candidate, position) === draft.id);
    save(index === -1 ? [...entries, entry] : entries.map((candidate, position) => (position === index ? entry : candidate)));
    editing = null;
    void focus(`[data-edit="${CSS.escape(draft.id)}"]`);
  }

  function setEnabled(key: string, enabled: boolean): void {
    save(entries.map((entry, index) => (routineKey(entry, index) === key && entry && typeof entry === "object" ? { ...entry, enabled } : entry)));
  }

  function remove(key: string): void {
    save(entries.filter((entry, index) => routineKey(entry, index) !== key));
    void focus("[data-new-routine]");
  }

  /** The action id of each routine's Run now that has not succeeded yet: running it again retries that action, so PlaneAI creates its task once. */
  const unfinishedRuns = new Map<string, string>();

  async function runNow(routine: Routine): Promise<void> {
    running = { ...running, [routine.id]: true };
    const action_id = unfinishedRuns.get(routine.id) ?? newId();
    unfinishedRuns.set(routine.id, action_id);
    try {
      const { task, session } = await context.host.call<TaskCreation>("routines.runNow", { id: routine.id, action_id });
      unfinishedRuns.delete(routine.id);
      context.host.data.notify(session === "starting" ? `Created ${task.key}. Its session is starting.` : `Created ${task.key}`, "success");
    } catch (reason) {
      context.host.data.notify(`Could not run ${routine.name}: ${describeError(reason)}`, "error");
    } finally {
      running = { ...running, [routine.id]: false };
    }
    await refreshStatus();
  }
</script>

<!-- PlaneAI's dialog titles this "Routines" and scrolls it, so it neither repeats the title nor scrolls itself. -->
<main class="content" aria-label="Routines">
  <header class="header">
    <p class="lede">Create a task on a schedule, such as a weekly retro or a monthly report.</p>
    {#if rows.length > 0 && !editing}
      <button type="button" class="primary" data-new-routine onclick={create}>New routine</button>
    {/if}
  </header>

  {#if loadFailure}
    <div class="notice error" role="alert">
      <span>{loadFailure}</span>
      <button type="button" onclick={() => void load()}>Retry</button>
    </div>
  {:else if !settings}
    <p class="muted" role="status">Loading routines…</p>
  {:else if editing}
    <RoutineEditor
      initial={editing.draft}
      isNew={editing.isNew}
      {projects}
      {projectsFailure}
      onRetryProjects={() => void loadProjects()}
      {providers}
      {providersFailure}
      onRetryProviders={() => void loadProviders()}
      onSave={submit}
      onCancel={closeEditor}
    />
  {:else if rows.length === 0}
    <section class="empty">
      <h2>No routines yet</h2>
      <p class="muted">A routine adds a task to a project at the times you choose, even after PlaneAI was closed.</p>
      <button type="button" class="primary" data-new-routine onclick={create}>Create your first routine</button>
    </section>
  {:else}
    {#if statusFailure}
      <p class="notice warning" role="status">{statusFailure}</p>
    {/if}
    <ul class="list" aria-label="Routines">
      {#each rows as row (row.key)}
        <RoutineRow
          key={row.key}
          entry={row.entry}
          routine={row.routine}
          problem={row.problem}
          status={statuses[row.key]}
          {projects}
          {providers}
          {now}
          running={running[row.key] ?? false}
          onToggle={(enabled) => setEnabled(row.key, enabled)}
          onRun={() => row.routine && void runNow(row.routine)}
          onEdit={() => row.routine && edit(row.routine)}
          onDelete={() => remove(row.key)}
        />
      {/each}
    </ul>
  {/if}
</main>

<style>
  /* Inset like the dialog title; the header keeps the button's height so opening the editor does not shift it. */
  .content { display: grid; gap: var(--planeai-space-4); padding: 0 var(--planeai-space-5) var(--planeai-space-5); }
  .header { display: flex; align-items: center; justify-content: space-between; gap: var(--planeai-space-3); min-height: 32px; }
  .lede { min-width: 0; }
  .lede, .muted { color: var(--planeai-text-muted); }
  .list { display: grid; gap: var(--planeai-space-2); margin: 0; padding: 0; list-style: none; }
  .empty { display: grid; justify-items: center; gap: var(--planeai-space-2); padding: var(--planeai-space-6) var(--planeai-space-4); border: 1px dashed var(--planeai-border); border-radius: var(--planeai-radius); text-align: center; }
  .empty button { margin-top: var(--planeai-space-2); }
  .notice { display: flex; align-items: center; justify-content: space-between; gap: var(--planeai-space-3); padding: var(--planeai-space-2) var(--planeai-space-3); border: 1px solid var(--planeai-border); border-radius: var(--planeai-radius); }
  .notice.error { color: var(--planeai-danger); }
  .notice.warning { color: var(--planeai-warning); }
  :global(button.primary) { border-color: var(--planeai-accent); background: var(--planeai-accent); color: var(--planeai-on-accent); }
  :global(button.primary:hover:not(:disabled)) { background: var(--planeai-accent); filter: brightness(1.08); }
</style>
