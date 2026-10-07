<script lang="ts">
  import { tick } from "svelte";
  import type { Routine } from "../src/routine";
  import { describe, HORIZON_DAYS } from "../src/schedule";
  import { absolute, relative } from "./format";
  import type { Project, RoutineStatus } from "./host";
  import { providerName, type SessionProviders } from "./providers";

  let {
    key,
    entry,
    routine,
    problem,
    status,
    projects,
    providers,
    now,
    running,
    onToggle,
    onRun,
    onEdit,
    onDelete,
  }: {
    key: string;
    entry: unknown;
    routine: Routine | undefined;
    problem: string | null;
    status: RoutineStatus | undefined;
    projects: Project[] | null;
    providers: SessionProviders | null;
    now: Date;
    running: boolean;
    onToggle: (enabled: boolean) => void;
    onRun: () => void;
    onEdit: () => void;
    onDelete: () => void;
  } = $props();

  let confirming = $state(false);
  let confirmButton = $state<HTMLButtonElement>();
  let deleteButton = $state<HTMLButtonElement>();

  const rawName = $derived(entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string" ? ((entry as Record<string, unknown>).name as string) : "");
  const name = $derived(routine?.name ?? (rawName.trim() || "Untitled routine"));
  const project = $derived(routine && projects ? projects.find((candidate) => candidate.path === routine.project_path) : undefined);
  const projectMissing = $derived(!!routine && !!projects && !project);
  const nextRun = $derived(status?.next_run ? new Date(status.next_run) : null);
  const error = $derived(problem ?? status?.error ?? null);
  const titleId = $derived(`routine-${key}`);

  async function askToDelete(): Promise<void> {
    confirming = true;
    await tick();
    confirmButton?.focus();
  }

  /** Back to Delete, so focus does not fall to the page where Escape would close the whole dialog. */
  async function cancelDelete(): Promise<void> {
    confirming = false;
    await tick();
    deleteButton?.focus();
  }
</script>

<li class="row" class:paused={routine && !routine.enabled} aria-labelledby={titleId}>
  <div class="main">
    <div class="title-line">
      <h2 id={titleId} class="name">{name}</h2>
      {#if routine}
        <span class="schedule">{describe(routine.schedule)}</span>
      {/if}
    </div>
    <dl class="facts">
      {#if routine}
        <div>
          <dt>Project</dt>
          {#if projectMissing}
            <dd class="warning">Project missing or hidden</dd>
          {:else}
            <dd>{project?.name ?? routine.project_path.split(/[\\/]/).filter(Boolean).pop() ?? routine.project_path}</dd>
          {/if}
        </div>
        <div>
          <dt>Next run</dt>
          {#if !routine.enabled}
            <dd class="muted">Paused</dd>
          {:else if nextRun}
            <dd><time datetime={nextRun.toISOString()} title={nextRun.toLocaleString()}>{relative(nextRun, now)}</time> <span class="muted">· {absolute(nextRun)}</span></dd>
          {:else if status}
            <dd class="muted">None in the next {HORIZON_DAYS} days</dd>
          {:else}
            <dd class="muted">…</dd>
          {/if}
        </div>
        {#if routine.task.start.enabled}
          <div>
            <dt>Session</dt>
            <dd class="session">Starts with {providerName(providers, routine.task.start.provider)}</dd>
          </div>
        {/if}
        {#if status?.last_task_key}
          <div>
            <dt>Last task</dt>
            <dd class="key">{status.last_task_key}</dd>
          </div>
        {/if}
      {/if}
    </dl>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  </div>

  <div class="controls">
    <label class="switch">
      <input
        type="checkbox"
        role="switch"
        checked={routine?.enabled ?? false}
        disabled={!routine}
        aria-label={`Enable ${name}`}
        onchange={(event) => onToggle(event.currentTarget.checked)}
      />
    </label>
    {#if confirming}
      <div class="confirm" role="group" aria-label={`Delete ${name}?`}>
        <span class="confirm-label">Delete?</span>
        <button type="button" class="danger" bind:this={confirmButton} onclick={onDelete}>Delete</button>
        <button type="button" onclick={() => void cancelDelete()}>Cancel</button>
      </div>
    {:else}
      <div class="actions">
        <button type="button" disabled={!routine || running} onclick={onRun} aria-label={`Run ${name} now`}>{running ? "Running…" : "Run now"}</button>
        <button type="button" disabled={!routine} data-edit={key} onclick={onEdit} aria-label={`Edit ${name}`}>Edit</button>
        <button type="button" bind:this={deleteButton} onclick={() => void askToDelete()} aria-label={`Delete ${name}`}>Delete</button>
      </div>
    {/if}
  </div>
</li>

<style>
  .row { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--planeai-space-3); padding: var(--planeai-space-3) var(--planeai-space-4); border: 1px solid var(--planeai-border); border-radius: var(--planeai-radius); background: var(--planeai-surface); }
  .main { display: grid; flex: 1 1 320px; gap: var(--planeai-space-2); min-width: 0; }
  .title-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--planeai-space-1) var(--planeai-space-3); min-width: 0; }
  .name { overflow: hidden; margin: 0; text-overflow: ellipsis; white-space: nowrap; }
  .paused .name, .paused .schedule { color: var(--planeai-text-muted); }
  .schedule { color: var(--planeai-text-muted); }
  .facts { display: flex; flex-wrap: wrap; gap: var(--planeai-space-1) var(--planeai-space-5); margin: 0; }
  .facts div { display: flex; gap: var(--planeai-space-2); min-width: 0; }
  dt { color: var(--planeai-text-subtle); }
  dd { overflow: hidden; margin: 0; text-overflow: ellipsis; white-space: nowrap; }
  .key { font-family: var(--planeai-font-mono); }
  .muted { color: var(--planeai-text-muted); }
  .warning { color: var(--planeai-warning); }
  .error { color: var(--planeai-danger); overflow-wrap: anywhere; }
  .controls { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: var(--planeai-space-3); }
  .actions, .confirm { display: flex; align-items: center; gap: var(--planeai-space-2); }
  .confirm-label { color: var(--planeai-danger); }
  .danger { border-color: var(--planeai-danger); color: var(--planeai-danger); }
  .switch { display: inline-flex; }
  .switch input { appearance: none; position: relative; width: 34px; height: 20px; margin: 0; padding: 0; border: 1px solid var(--planeai-border-strong); border-radius: 999px; background: var(--planeai-surface-raised); cursor: pointer; transition: background-color 120ms ease; }
  .switch input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--planeai-text-muted); transition: transform 120ms ease; }
  .switch input:checked { border-color: var(--planeai-accent); background: var(--planeai-accent); }
  .switch input:checked::after { background: var(--planeai-on-accent); transform: translateX(14px); }
  .switch input:disabled { cursor: not-allowed; opacity: 0.55; }
  .switch input:focus-visible { outline: 2px solid var(--planeai-accent); outline-offset: 2px; }
</style>
