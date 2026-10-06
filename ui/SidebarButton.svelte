<script lang="ts">
  import { onMount } from "svelte";
  import type { SidebarUiContext } from "./host";
  import { nextRunHint } from "./next-run";

  let { context }: { context: SidebarUiContext } = $props();

  const REFRESH_MS = 30_000;

  let hint = $state<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      hint = nextRunHint(await context.host.settings.get(), new Date());
    } catch {
      hint = null;
    }
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const unlisten = context.host.data.onChanged?.(() => void refresh());
    return () => {
      clearInterval(timer);
      unlisten?.();
    };
  });
</script>

<button type="button" aria-label="Routines" onclick={() => context.host.navigation.open("routines", "routines")}>
  <span class="name">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
    <span class="label" data-label>Routines</span>
  </span>
  {#if hint}<span class="hint" data-hint>{hint}</span>{/if}
</button>

<style>
  /* The frame is exactly this button: transparent around its rounded corners, and as tall as it. */
  :global(html),
  :global(body) {
    background: transparent;
    height: auto;
    min-height: 0;
  }

  /* PlaneAI's own sidebar header buttons, New session and New project. */
  button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-width: 0;
    height: 32px;
    min-height: 0;
    padding: 0 12px;
    border: 1px solid var(--planeai-border);
    border-radius: 8px;
    background: var(--planeai-surface-raised);
    color: var(--planeai-text-muted);
    font-family: var(--planeai-font-sans);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.5;
    transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  @media (hover: hover) {
    button:hover:not(:disabled) {
      background: var(--planeai-surface-raised);
      opacity: 0.8;
    }
  }

  /* Like the host's buttons; the sidebar's accent border shows where the keyboard is. */
  button:focus-visible {
    outline: none;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }

  svg {
    display: block;
    flex-shrink: 0;
    width: 14px;
    height: 14px;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    flex-shrink: 0;
    margin-left: 4px;
    color: var(--planeai-text-subtle);
    font-family: var(--planeai-font-mono);
    font-size: 10px;
  }

  /* PlaneAI's header buttons drop to their icon below a 220px sidebar: its border and padding leave a frame under 195px. */
  @media (max-width: 194.98px) {
    .label,
    .hint {
      display: none;
    }
  }
</style>
