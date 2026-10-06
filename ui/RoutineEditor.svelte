<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { checkRoutine, parseSchedule, PRIORITIES, WEEKDAYS, type Field, type Weekday } from "../src/routine";
  import { nextRun } from "../src/schedule";
  import { PLACEHOLDERS, render } from "../src/template";
  import { PRESETS, PRIORITY_LABELS, toEntry, toSchedule, type Draft } from "./draft";
  import { absolute } from "./format";
  import type { Project } from "./host";
  import { findProvider, providerName, type SessionProviders } from "./providers";

  let {
    initial,
    isNew,
    projects,
    projectsFailure,
    onRetryProjects,
    providers,
    providersFailure,
    onRetryProviders,
    onSave,
    onCancel,
  }: {
    initial: Draft;
    isNew: boolean;
    projects: Project[] | null;
    projectsFailure: string | null;
    onRetryProjects: () => void;
    providers: SessionProviders | null;
    providersFailure: string | null;
    onRetryProviders: () => void;
    onSave: (draft: Draft) => void;
    onCancel: () => void;
  } = $props();

  const DAY_LABELS: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  const PREVIEW_RUNS = 3;

  // The parent mounts a fresh editor per routine, so the first value is the only one.
  let draft = $state(untrack(() => ({ ...initial, weekdays: [...initial.weekdays] })));
  let nameInput = $state<HTMLInputElement>();
  /** Fields the user has left; only those show their problem beside them. */
  let touched = $state(new Set<Field>());

  const knownProject = $derived(projects?.some((project) => project.path === draft.project_path) ?? true);
  const problems = $derived.by(() => {
    const checked = checkRoutine(toEntry(draft));
    const found = "problems" in checked ? checked.problems : [];
    const byField = new Map(found.map((problem) => [problem.field, problem.message]));
    if (draft.project_path && !knownProject) byField.set("project", "This project is missing or hidden in PlaneAI. Choose another.");
    return byField;
  });
  const schedule = $derived(parseSchedule(toSchedule(draft), []));
  const runs = $derived.by(() => {
    if (!schedule) return [];
    const found: Date[] = [];
    let after = new Date();
    for (let index = 0; index < PREVIEW_RUNS; index++) {
      const next = nextRun(schedule, after);
      if (!next) break;
      found.push(next);
      after = next;
    }
    return found;
  });
  const provider = $derived(findProvider(providers, draft.start.provider));
  const knownProvider = $derived(!providers || draft.start.provider === null || providers.providers.some((candidate) => candidate.key === draft.start.provider));
  /** As in PlaneAI's task form: the draft keeps the user's choice, the provider decides whether it applies. */
  const autoApproveBlocked = $derived(provider && !provider.auto_approve ? `${provider.label} does not support auto-approve.` : null);
  const previewTitle = $derived(runs[0] && draft.title.trim() ? render(draft.title.trim(), { at: runs[0], routine: draft.name.trim() }) : null);

  onMount(() => nameInput?.focus());

  const touch = (field: Field) => () => (touched = new Set([...touched, field]));
  const shown = (field: Field) => (touched.has(field) ? (problems.get(field) ?? null) : null);

  function toggleDay(day: Weekday): void {
    draft.weekdays = draft.weekdays.includes(day) ? draft.weekdays.filter((candidate) => candidate !== day) : [...draft.weekdays, day];
    touch("weekdays")();
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (problems.size === 0) onSave({ ...draft, start: { ...draft.start, auto_approve: draft.start.auto_approve && !autoApproveBlocked } });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Claimed, so PlaneAI does not close the whole dialog.
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  }
</script>

{#snippet problem(field: Field)}
  {#if shown(field)}
    <span class="field-problem" id={`problem-${field}`}>{shown(field)}</span>
  {/if}
{/snippet}

<!-- Escape is caught here, below the window where PlaneAI listens for it to close the dialog. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form class="editor" aria-labelledby="editor-title" onsubmit={submit} onkeydown={onKeydown} novalidate>
  <h2 id="editor-title">{isNew ? "New routine" : `Edit ${draft.name.trim() || "routine"}`}</h2>

  <div class="grid">
    <label class="field">
      <span class="label">Name</span>
      <input bind:this={nameInput} bind:value={draft.name} onblur={touch("name")} placeholder="Weekly retro" aria-invalid={!!shown("name")} aria-describedby={shown("name") ? "problem-name" : undefined} />
      {@render problem("name")}
    </label>

    <label class="field">
      <span class="label">Project</span>
      <select bind:value={draft.project_path} onblur={touch("project")} disabled={!projects} aria-invalid={!!shown("project")} aria-describedby={shown("project") ? "problem-project" : undefined}>
        {#if !projects}
          <option value={draft.project_path}>{projectsFailure ? "Projects unavailable" : "Loading projects…"}</option>
        {:else}
          {#if !draft.project_path}
            <option value="" disabled>Choose a project</option>
          {:else if !knownProject}
            <option value={draft.project_path} disabled>{draft.project_path} (missing)</option>
          {/if}
          {#each projects as project (project.id)}
            <option value={project.path}>{project.name}</option>
          {/each}
        {/if}
      </select>
      {#if projectsFailure}
        <span class="field-problem">{projectsFailure} <button type="button" class="link" onclick={onRetryProjects}>Retry</button></span>
      {:else if projects && projects.length === 0}
        <span class="hint">Add a project to PlaneAI first.</span>
      {/if}
      {@render problem("project")}
    </label>
  </div>

  <fieldset class="section">
    <legend class="label">Schedule</legend>
    <div class="grid schedule">
      <label class="field">
        <span class="label">Repeats</span>
        <select bind:value={draft.preset}>
          {#each PRESETS as preset (preset.id)}
            <option value={preset.id}>{preset.label}</option>
          {/each}
        </select>
      </label>

      {#if draft.preset === "cron"}
        <label class="field wide">
          <span class="label">Cron expression</span>
          <input class="mono" bind:value={draft.expression} onblur={touch("cron")} spellcheck="false" placeholder="0 9 * * 1-5" aria-invalid={!!problems.get("cron")} aria-describedby="cron-validity" />
          <span id="cron-validity" class={problems.get("cron") ? "field-problem" : "hint"} aria-live="polite">
            {problems.get("cron") ?? "Minute, hour, day of month, month, day of week, in this machine's time zone."}
          </span>
        </label>
      {:else}
        <label class="field">
          <span class="label">Time</span>
          <input type="time" bind:value={draft.time} onblur={touch("time")} aria-invalid={!!shown("time")} aria-describedby={shown("time") ? "problem-time" : undefined} />
          {@render problem("time")}
        </label>
      {/if}

      {#if draft.preset === "monthly"}
        <label class="field">
          <span class="label">Day of month</span>
          <input type="number" min="1" max="31" step="1" bind:value={draft.day} onblur={touch("day")} aria-invalid={!!shown("day")} aria-describedby={shown("day") ? "problem-day" : "day-hint"} />
          {#if shown("day")}
            {@render problem("day")}
          {:else if (draft.day ?? 0) > 28}
            <span class="hint" id="day-hint">Months without day {draft.day} are skipped.</span>
          {/if}
        </label>
      {/if}
    </div>

    {#if draft.preset === "days"}
      <div class="days" role="group" aria-label="Days" aria-describedby={problems.get("weekdays") ? "problem-weekdays" : undefined}>
        {#each WEEKDAYS as day (day)}
          <button type="button" class="chip" aria-pressed={draft.weekdays.includes(day)} onclick={() => toggleDay(day)}>{DAY_LABELS[day]}</button>
        {/each}
      </div>
      {#if problems.get("weekdays")}
        <span class="field-problem" id="problem-weekdays">{problems.get("weekdays")}</span>
      {/if}
    {/if}
  </fieldset>

  <fieldset class="section">
    <legend class="label">Task</legend>
    <label class="field">
      <span class="label">Title</span>
      <input bind:value={draft.title} onblur={touch("title")} placeholder={"Retro {{date}}"} aria-invalid={!!shown("title")} aria-describedby={shown("title") ? "problem-title" : "placeholder-hint"} />
      {@render problem("title")}
    </label>
    <label class="field">
      <span class="label">Description</span>
      <textarea bind:value={draft.description} rows="4" placeholder="Markdown" aria-describedby="placeholder-hint"></textarea>
    </label>
    <p class="hint" id="placeholder-hint">
      Placeholders, filled in from the run time:
      {#each PLACEHOLDERS as name (name)}<code>{`{{${name}}}`}</code>{" "}{/each}
    </p>
    <div class="grid">
      <label class="field">
        <span class="label">Priority</span>
        <select bind:value={draft.priority}>
          {#each PRIORITIES as priority (priority)}
            <option value={priority}>{PRIORITY_LABELS[priority]}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="label">Tags</span>
        <input bind:value={draft.tags} placeholder="ritual, team" aria-describedby="tags-hint" />
        <span class="hint" id="tags-hint">Separate tags with commas.</span>
      </label>
    </div>
  </fieldset>

  <fieldset class="section">
    <legend class="label">Session</legend>
    <label class="check">
      <input type="checkbox" bind:checked={draft.start.enabled} />
      Start session immediately
    </label>
    {#if draft.start.enabled}
      <div class="grid">
        <label class="field" data-field="provider">
          <span class="label">Provider</span>
          <select bind:value={() => draft.start.provider ?? "", (key) => (draft.start.provider = key || null)} disabled={!providers}>
            {#if !providers}
              <option value={draft.start.provider ?? ""}>{providersFailure ? "Providers unavailable" : "Loading providers…"}</option>
            {:else}
              <option value="">Default ({providerName(providers, null)})</option>
              {#if !knownProvider}
                <option value={draft.start.provider}>{draft.start.provider} (unavailable)</option>
              {/if}
              {#each providers.providers as choice (choice.key)}
                <option value={choice.key}>{choice.label}</option>
              {/each}
            {/if}
          </select>
        </label>
        <div class="checks">
          <label class="check">
            <input type="checkbox" bind:checked={draft.start.use_worktree} />
            Worktree
          </label>
          <label class="check">
            <input
              type="checkbox"
              bind:checked={() => draft.start.auto_approve && !autoApproveBlocked, (value) => (draft.start.auto_approve = value)}
              disabled={!!autoApproveBlocked}
              aria-describedby={autoApproveBlocked ? "auto-approve-hint" : undefined}
            />
            Auto-approve
          </label>
        </div>
      </div>
      {#if providersFailure}
        <span class="field-problem" id="providers-problem">{providersFailure} <button type="button" class="link" onclick={onRetryProviders}>Retry</button></span>
      {/if}
      {#if autoApproveBlocked}
        <span class="hint" id="auto-approve-hint">{autoApproveBlocked}</span>
      {/if}
      <p class="hint" id="session-hint">The branch, session name and prompt follow PlaneAI's task templates.</p>
    {/if}
  </fieldset>

  <section class="preview" aria-label="Preview">
    <h3>Preview</h3>
    {#if !schedule}
      <p class="muted">Finish the schedule to see when it runs.</p>
    {:else if runs.length === 0}
      <p class="muted">This schedule does not run in the next 400 days.</p>
    {:else}
      <ol class="runs">
        {#each runs as run (run.getTime())}
          <li><time datetime={run.toISOString()}>{absolute(run)}</time></li>
        {/each}
      </ol>
      {#if previewTitle}
        <p class="next-title"><span class="muted">Next task:</span> {previewTitle}</p>
      {/if}
    {/if}
  </section>

  <div class="footer">
    {#if problems.size > 0}
      <p class="reasons" id="save-reasons">{[...problems.values()].join(" ")}</p>
    {/if}
    <div class="buttons">
      <button type="button" onclick={onCancel}>Cancel</button>
      <button type="submit" class="primary" disabled={problems.size > 0} aria-describedby={problems.size > 0 ? "save-reasons" : undefined}>{isNew ? "Create routine" : "Save"}</button>
    </div>
  </div>
</form>

<style>
  .editor { display: grid; gap: var(--planeai-space-4); padding: var(--planeai-space-4); border: 1px solid var(--planeai-border); border-radius: var(--planeai-radius); background: var(--planeai-surface); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--planeai-space-3); }
  .schedule .wide { grid-column: span 2; }
  .section { display: grid; gap: var(--planeai-space-3); min-width: 0; margin: 0; padding: 0; border: 0; }
  .section > legend { margin-bottom: var(--planeai-space-2); padding: 0; font-weight: 600; color: var(--planeai-text); }
  .field { display: grid; gap: var(--planeai-space-1); align-content: start; min-width: 0; }
  .label { color: var(--planeai-text-subtle); font-size: 12px; }
  input, select, textarea { width: 100%; min-width: 0; }
  /* WebKit draws a time input taller than a text input or select; one height keeps the rows aligned. */
  input, select { height: 34px; }
  textarea { resize: vertical; }
  ::placeholder { color: var(--planeai-text-subtle); opacity: 1; }
  .mono, code { font-family: var(--planeai-font-mono); }
  [aria-invalid="true"] { border-color: var(--planeai-danger); }
  .hint, .muted { color: var(--planeai-text-muted); font-size: 12px; }
  .field-problem { color: var(--planeai-danger); font-size: 12px; }
  .hint code { margin-right: var(--planeai-space-1); padding: 0 3px; border-radius: 4px; background: var(--planeai-surface-raised); }
  .check { display: inline-flex; align-items: center; gap: var(--planeai-space-2); width: fit-content; cursor: pointer; }
  /* Drawn like the row's switch: WebKit's native box turns gray with the dark theme's light accent. */
  .check input { appearance: none; position: relative; flex: none; width: 16px; height: 16px; margin: 0; padding: 0; border: 1px solid var(--planeai-border-strong); border-radius: 4px; background: var(--planeai-main); cursor: inherit; }
  .check input:checked { border-color: var(--planeai-accent); background: var(--planeai-accent); }
  .check input:checked::after { content: ""; position: absolute; top: 2px; left: 5px; width: 4px; height: 8px; border: solid var(--planeai-on-accent); border-width: 0 2px 2px 0; transform: rotate(45deg); }
  .check input:disabled { opacity: 0.55; }
  .check:has(input:disabled) { color: var(--planeai-text-muted); cursor: not-allowed; }
  /* Bottom-aligned with the provider select; nothing may follow the select inside its field. */
  .checks { display: flex; flex-wrap: wrap; align-items: center; gap: var(--planeai-space-4); align-self: end; min-height: 34px; }
  .days { display: flex; flex-wrap: wrap; gap: var(--planeai-space-2); }
  .chip { min-width: 52px; border-radius: 999px; background: var(--planeai-main); }
  .chip[aria-pressed="true"], .chip[aria-pressed="true"]:hover:not(:disabled) { border-color: var(--planeai-accent); background: var(--planeai-accent); color: var(--planeai-on-accent); }
  .link { min-height: 0; padding: 0; border: 0; background: none; color: var(--planeai-accent); text-decoration: underline; }
  .link:hover:not(:disabled) { background: none; }
  .preview { display: grid; gap: var(--planeai-space-2); padding: var(--planeai-space-3); border: 1px solid var(--planeai-border); border-radius: var(--planeai-radius); background: var(--planeai-main); }
  .runs { display: flex; flex-wrap: wrap; gap: var(--planeai-space-1) var(--planeai-space-4); margin: 0; padding: 0; list-style: none; }
  .next-title { overflow-wrap: anywhere; }
  .footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--planeai-space-3); }
  .reasons { flex: 1 1 240px; color: var(--planeai-danger); font-size: 12px; }
  .buttons { display: flex; gap: var(--planeai-space-2); }
  @media (max-width: 520px) {
    .schedule .wide { grid-column: auto; }
  }
</style>
